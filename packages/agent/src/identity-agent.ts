/**
 * The identity agent. SPRINT1.md, Component 5; SPRINT2.md, Stage B, Component 1.
 *
 * Runs on the Claude Agent SDK with every built-in tool disabled (`tools: []`) and exactly
 * the identity-gateway tools allowed. That is the whole point of using this SDK here
 * rather than Claude Code directly: Claude Code ships Bash, file write and web access by
 * default, and turning those off one at a time is a subtraction problem that needs
 * maintenance every release. `tools: []` plus a closed `allowedTools` list is the addition
 * problem instead — nothing runs unless it is named here.
 *
 * The actor identity is a spawn-time parameter of this process, sent to the gateway as a
 * request header this file sets before the model ever runs. Nothing the model produces can
 * set or change it: there is no tool parameter, no prompt content, and no code path here that
 * reads an actor from anywhere but `options.actor`.
 *
 * Stage B gives this process its own credential for the first time — a certificate scoped to
 * this agent's own app registration, carrying the Gateway.Invoke role on the identity gateway's
 * API and no Graph permission at all (see the README, "Stage B: agents get a credential", for
 * why that is safe and why Sprint 1 avoided it). It authenticates this process to its own
 * gateway over HTTP; it cannot be replayed against Graph, and Entra itself refuses it against
 * the MDM gateway (see prove-isolation.ts's agent-token checks). CertificateCredential is the
 * one runtime import this file takes from @helpdesk/identity-gateway — see that package's
 * index.ts for why this specific class is the one narrow exception to SPRINT1.md's rule.
 *
 * This process, not the gateway, writes the `request` and `no_tool_called` audit records
 * (see session-audit.ts for why that file exists instead of importing the gateway's own
 * AuditLog): a `request` record before the model is ever called, and a `no_tool_called`
 * record if the whole session ends without the model calling a tool.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { query, type McpServerConfig, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { CertificateCredential } from "@helpdesk/identity-gateway";

import { ensureEnvLoaded } from "./env.js";
import { DEFAULT_AGENT_MODEL } from "./models.js";
import { SessionAudit } from "./session-audit.js";

const GATEWAY_SERVER_NAME = "identity-gateway";
const GATEWAY_TOOLS = [
  "list_user_groups",
  "list_managed_groups",
  "add_user_to_group",
  "remove_user_from_group",
] as const;
/** IDENTITY_GATEWAY_URL is the gateway's origin (no path): the web app's decide-endpoint client
 * shares the same env var and appends its own path, see packages/web/src/bin/web.ts. */
const GATEWAY_BASE_URL = process.env.IDENTITY_GATEWAY_URL ?? "http://127.0.0.1:3001";
const GATEWAY_URL = `${GATEWAY_BASE_URL}/mcp`;

/**
 * This agent's own credential env, separate from the gateway's (SPRINT1.md: this package still
 * never reads a Graph certificate path). Declared here rather than imported from a shared
 * module, same reasoning as GATEWAY_TOOLS and SYSTEM_PROMPT above: the mdm-agent's equivalent
 * schema lives in mdm-agent.ts, its own text, naming its own variables.
 */
const agentCredentialEnvSchema = z.object({
  AZURE_TENANT_ID: z.guid(),
  AZURE_IDENTITY_AGENT_CLIENT_ID: z.guid(),
  AZURE_IDENTITY_AGENT_CERT_PATH: z.string().min(1),
  AZURE_IDENTITY_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character hex SHA-1 thumbprint"),
  IDENTITY_GATEWAY_AUDIENCE: z.string().min(1),
});

/** This agent's own certificate credential, and the audience it authenticates to. */
function loadAgentCredential(): { credential: CertificateCredential; audience: string } {
  const parsed = agentCredentialEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Identity agent's own credential environment is incomplete or malformed:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  const credential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_IDENTITY_AGENT_CLIENT_ID,
    thumbprint: env.AZURE_IDENTITY_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_IDENTITY_AGENT_CERT_PATH),
  });
  return { credential, audience: env.IDENTITY_GATEWAY_AUDIENCE };
}

const SYSTEM_PROMPT = [
  "You are the identity helpdesk agent. Your only job is to answer questions about a user's",
  "group membership and to request group membership changes, using only the identity-gateway",
  "tools you have been given. You have no other tools and no other way to act on a request.",
  "",
  "Report every tool result honestly and plainly, in your own words. A pending or denied",
  "result is not a problem to solve around: do not call the same tool again for it, do not",
  "look for a different tool or a different way to get the same effect, and never say a",
  "change was made when it was not. If nothing you have covers what was asked, say so.",
].join("\n");

/**
 * The slice of query()'s surface this file actually uses: a function returning something you
 * can iterate for SDKMessages. `query` itself returns the much larger `Query` interface (with
 * interrupt(), setPermissionMode(), ...), which is assignable here because Query extends
 * AsyncGenerator<SDKMessage, void>. Narrowing the injection point to this shape means a test
 * fake only has to be an async generator function, not the full control-request surface.
 */
export type RunQuery = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface IdentityAgentOptions {
  actor: string;
  requestText: string;
  /** Generated if omitted. */
  requestId?: string;
  dbPath?: string;
  /** Injectable for tests; defaults to the Agent SDK's query(). */
  runQuery?: RunQuery;
  /** Injectable for tests; defaults to minting a real token via this agent's own certificate. */
  getAccessToken?: () => Promise<string>;
}

export interface IdentityAgentResult {
  requestId: string;
  toolWasCalled: boolean;
  reply: string;
}

async function mintAccessToken(): Promise<string> {
  const { credential, audience } = loadAgentCredential();
  const { token } = await credential.getToken(`${audience}/.default`);
  return token;
}

export async function runIdentityAgent(options: IdentityAgentOptions): Promise<IdentityAgentResult> {
  // Load .env now, before runQuery spawns the SDK's own subprocess. options.env is left unset
  // below, so that subprocess inherits process.env — this is what actually gets the key there.
  ensureEnvLoaded();

  const requestId = options.requestId ?? randomUUID();
  const dbPath = options.dbPath ?? resolve("data/identity-helpdesk.db");
  const runQuery = options.runQuery ?? query;
  const getAccessToken = options.getAccessToken ?? mintAccessToken;

  const opening = new SessionAudit(dbPath);
  opening.append({ requestId, actor: options.actor, agent: "identity-agent", decision: "request", content: options.requestText });
  opening.close();

  // The token proves which agent is calling and that Entra granted it Gateway.Invoke on this
  // gateway's API, nothing more. actor and requestId travel as headers this process sets
  // itself, never as a tool parameter: the same trust tier a --actor spawn argument was over
  // stdio, just carried over HTTP instead (SPRINT2.md, Stage B, Component 3).
  const token = await getAccessToken();
  const mcpServers: Record<string, McpServerConfig> = {
    [GATEWAY_SERVER_NAME]: {
      type: "http",
      url: GATEWAY_URL,
      headers: {
        authorization: `Bearer ${token}`,
        "x-actor": options.actor,
        "x-request-id": requestId,
      },
    },
  };

  const stream = runQuery({
    prompt: options.requestText,
    options: {
      model: process.env.HELPDESK_AGENT_MODEL ?? DEFAULT_AGENT_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      mcpServers,
      tools: [],
      allowedTools: GATEWAY_TOOLS.map((tool) => `mcp__${GATEWAY_SERVER_NAME}__${tool}`),
      permissionMode: "dontAsk",
      persistSession: false,
    } satisfies Options,
  });

  let toolWasCalled = false;
  let reply = "";
  let modelUsage: Record<string, { inputTokens: number; outputTokens: number }> = {};
  for await (const message of stream) {
    if (message.type === "assistant" && message.message.content.some((block) => block.type === "tool_use")) {
      toolWasCalled = true;
    }
    if (message.type === "result") {
      // The SDK's own type has modelUsage as required, but this is a fake-able external
      // boundary (an older SDK version, or a test double built before this field existed): a
      // missing usage report should mean "record nothing", never a crash.
      modelUsage = message.modelUsage ?? {};
      if (message.subtype === "success") reply = message.result;
    }
  }

  // Usage is a property of the model turn, not of whether it called a tool, so it is recorded
  // every time — unlike no_tool_called, which only applies when nothing else already covers the
  // outcome (see Component 3: the gateway's own tool-call records are the trail when one was).
  const closing = new SessionAudit(dbPath);
  if (!toolWasCalled) {
    closing.append({ requestId, actor: options.actor, agent: "identity-agent", decision: "no_tool_called", content: reply });
  }
  for (const [model, usage] of Object.entries(modelUsage)) {
    closing.appendUsage({ requestId, actor: options.actor, agent: "identity-agent", model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
  }
  closing.close();

  return { requestId, toolWasCalled, reply };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      actor: { type: "string" },
      request: { type: "string" },
      "request-id": { type: "string" },
      db: { type: "string" },
    },
    strict: true,
  });
  if (!values.actor || !values.request) throw new Error("--actor and --request are required");

  const result = await runIdentityAgent({
    actor: values.actor,
    requestText: values.request,
    ...(values["request-id"] ? { requestId: values["request-id"] } : {}),
    ...(values.db ? { dbPath: values.db } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
