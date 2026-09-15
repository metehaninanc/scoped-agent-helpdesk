/**
 * The Microsoft Graph calls the gateway makes, and nothing else. Two operations, matching the
 * two tools in SPRINT1.md. If a third call is needed, that is a scope decision, not a detail.
 *
 * Inputs are re-validated with the same schemas the policy engine uses, so nothing that did
 * not pass decide() can be shaped into a URL here.
 */
import { groupId as groupIdSchema, userPrincipalName as upnSchema } from "../policy/schemas.js";
import type { AccessToken } from "./certificate-credential.js";

export const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const DEFAULT_BASE_URL = "https://graph.microsoft.com/v1.0";

/** Anything that can mint a Graph token. CertificateCredential satisfies it. */
export interface TokenProvider {
  getToken(scope: string): Promise<AccessToken>;
}

export interface GraphClientOptions {
  credential: TokenProvider;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface GroupSummary {
  id: string;
  displayName: string;
}

export interface AddMemberResult {
  /** True when Graph reported the user was already a member. The desired state holds either way. */
  alreadyMember: boolean;
}

export class GraphError extends Error {
  override readonly name = "GraphError";
  constructor(
    readonly status: number,
    /** Graph error code, e.g. "Request_ResourceNotFound". "unknown" when the body was not JSON. */
    readonly code: string,
    message: string,
    /** Graph's request-id, for support tickets. */
    readonly requestId?: string,
  ) {
    super(`Graph ${status} ${code}: ${message}`);
  }
}

interface GraphErrorBody {
  error?: { code?: string; message?: string; innerError?: Record<string, unknown> };
}

interface Page<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

const ALREADY_MEMBER = /added object references already exist/i;

export class GraphClient {
  private readonly credential: TokenProvider;
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: GraphClientOptions) {
    this.credential = options.credential;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** GET /users/{upn}/memberOf, groups only. Directory roles and administrative units are not groups. */
  async listUserGroups(userPrincipalName: string): Promise<GroupSummary[]> {
    const upn = upnSchema.parse(userPrincipalName);
    const groups: GroupSummary[] = [];

    let url: string | undefined =
      `${this.baseUrl}/users/${encodeURIComponent(upn)}/memberOf/microsoft.graph.group?$select=id,displayName`;
    while (url !== undefined) {
      const page: Page<{ id: string; displayName?: string | null }> = await this.request(url);
      for (const g of page.value) groups.push({ id: g.id, displayName: g.displayName ?? "" });
      url = page["@odata.nextLink"];
    }
    return groups;
  }

  /** GET /users/{upn}?$select=id */
  async getUserId(userPrincipalName: string): Promise<string> {
    const upn = upnSchema.parse(userPrincipalName);
    const user: { id: string } = await this.request(`${this.baseUrl}/users/${encodeURIComponent(upn)}?$select=id`);
    return user.id;
  }

  /** POST /groups/{id}/members/$ref. Resolves the user first; $ref wants an object id, not a UPN. */
  async addUserToGroup(userPrincipalName: string, groupId: string): Promise<AddMemberResult> {
    const upn = upnSchema.parse(userPrincipalName);
    const group = groupIdSchema.parse(groupId);
    const userId = await this.getUserId(upn);

    try {
      await this.request(`${this.baseUrl}/groups/${encodeURIComponent(group)}/members/$ref`, {
        method: "POST",
        body: { "@odata.id": `${this.baseUrl}/directoryObjects/${userId}` },
      });
      return { alreadyMember: false };
    } catch (error) {
      if (error instanceof GraphError && error.status === 400 && ALREADY_MEMBER.test(error.message)) {
        return { alreadyMember: true };
      }
      throw error;
    }
  }

  private async request<T>(url: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
    const { token } = await this.credential.getToken(GRAPH_SCOPE);
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json" };
    if (options.body !== undefined) headers["content-type"] = "application/json";

    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);

    const response = await this.fetch(url, init);

    const text = await response.text();
    let json: unknown = undefined;
    try {
      json = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      // Non-JSON body: handled below via status alone.
    }

    if (!response.ok) {
      const body = (json ?? {}) as GraphErrorBody;
      const requestId = body.error?.innerError?.["request-id"];
      throw new GraphError(
        response.status,
        body.error?.code ?? "unknown",
        body.error?.message ?? (text.length > 0 ? `non-JSON response (${text.length} bytes)` : "empty response"),
        typeof requestId === "string" ? requestId : undefined,
      );
    }
    return json as T;
  }
}
