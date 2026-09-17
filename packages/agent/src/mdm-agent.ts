/**
 * The MDM agent. SPRINT2.md, Stage A build order: "Second app registration, MDM gateway, MDM
 * agent, and the gateway-to-Graph refusal captured." Stage B, Component 1.
 *
 * Deliberately its own file, not a parameterized copy of identity-agent.ts, even though the
 * shape is identical and much of the wording below echoes it. The two agents must not share an
 * allowlist or a system prompt constant: if they did, that shared constant would quietly become
 * the thing that defines the boundary between them, and the boundary is supposed to come from
 * credentials (a disjoint certificate per gateway, proven in prove-isolation.ts) and from this
 * file simply never mentioning the identity gateway's tools at all — not from a runtime check
 * that a shared list was assembled correctly. See agent-boundary.test.ts for what is actually
 * verified about that, and the README for what this layer's separation does and does not prove.
 *
 * Runs on the Claude Agent SDK with every built-in tool disabled (`tools: []`) and exactly the
 * mdm-gateway tools allowed. The actor identity is a spawn-time parameter of this process, sent
 * to the gateway as a request header this file sets; nothing the model produces can set or
 * change it.
 *
 * Stage B gives this process its own credential — a certificate scoped to this agent's own app
 * registration, carrying the Gateway.Invoke role on the MDM gateway's API and no Graph
 * permission at all. Its own env vars (AZURE_MDM_AGENT_*), its own audience
 * (MDM_GATEWAY_AUDIENCE): not shared with identity-agent.ts's equivalent, same reasoning as the
 * tool allowlist above. CertificateCredential is the one runtime import this file takes from
 * @helpdesk/identity-gateway — see that package's index.ts for why.
 *
 * This process, not the gateway, writes the `request` and `no_tool_called` audit records, into
 * the MDM gateway's own database file (data/mdm-helpdesk.db by default) — its own chain,
 * separate from the identity agent's, the same way the two gateways keep separate chains
 * (SPRINT2.md, Component 6).
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
import { SessionAudit } from "./session-audit.js";

const GATEWAY_SERVER_NAME = "mdm-gateway";
const GATEWAY_TOOLS = ["list_devices", "get_device"] as const;
/** MDM_GATEWAY_URL is the gateway's origin (no path), same convention as IDENTITY_GATEWAY_URL. */
const GATEWAY_BASE_URL = process.env.MDM_GATEWAY_URL ?? "http://127.0.0.1:3002";
const GATEWAY_URL = `${GATEWAY_BASE_URL}/mcp`;

/** This agent's own credential env. Declared here, not shared with identity-agent.ts (see file header). */
const agentCredentialEnvSchema = z.object({
  AZURE_TENANT_ID: z.guid(),
  AZURE_MDM_AGENT_CLIENT_ID: z.guid(),
  AZURE_MDM_AGENT_CERT_PATH: z.string().min(1),
  AZURE_MDM_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character hex SHA-1 thumbprint"),
  MDM_GATEWAY_AUDIENCE: z.string().min(1),
});

/** This agent's own certificate credential, and the audience it authenticates to. */
function loadAgentCredential(): { credential: CertificateCredential; audience: string } {
  const parsed = agentCredentialEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`MDM agent's own credential environment is incomplete or malformed:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  const credential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_MDM_AGENT_CLIENT_ID,
    thumbprint: env.AZURE_MDM_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_MDM_AGENT_CERT_PATH),
  });
  return { credential, audience: env.MDM_GATEWAY_AUDIENCE };
}

const SYSTEM_PROMPT = [
  "You are the MDM device lookup agent. Your only job is to answer questions about devices",
  "registered in the tenant, using only the mdm-gateway tools you have been given. You have no",
  "other tools and no other way to act on a request. This gateway has no write tools at all:",
  "you cannot change a device's state, only look devices up.",
  "",
  "Report every tool result honestly and plainly, in your own words. A denied or error result",
  "is not a problem to solve around: do not call the same tool again for it, do not look for a different tool or a different way to get the same effect. If nothing you have covers what was asked, say so.",
].join("\n");

/** Same shape as identity-agent.ts's RunQuery, declared again rather than imported (see file header). */
export type RunQuery = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface MdmAgentOptions {
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

export interface MdmAgentResult {
  requestId: string;
  toolWasCalled: boolean;
  reply: string;
}

async function mintAccessToken(): Promise<string> {
  const { credential, audience } = loadAgentCredential();
  const { token } = await credential.getToken(`${audience}/.default`);
  return token;
}

export async function runMdmAgent(options: MdmAgentOptions): Promise<MdmAgentResult> {
  // Load .env now, before runQuery spawns the SDK's own subprocess. options.env is left unset
  // below, so that subprocess inherits process.env — this is what actually gets the key there.
  ensureEnvLoaded();

  const requestId = options.requestId ?? randomUUID();
  const dbPath = options.dbPath ?? resolve("data/mdm-helpdesk.db");
  const runQuery = options.runQuery ?? query;
  const getAccessToken = options.getAccessToken ?? mintAccessToken;

  const opening = new SessionAudit(dbPath);
  opening.append({ requestId, actor: options.actor, agent: "mdm-agent", decision: "request", content: options.requestText });
  opening.close();

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
  for await (const message of stream) {
    if (message.type === "assistant" && message.message.content.some((block) => block.type === "tool_use")) {
      toolWasCalled = true;
    }
    if (message.type === "result" && message.subtype === "success") {
      reply = message.result;
    }
  }

  if (!toolWasCalled) {
    const closing = new SessionAudit(dbPath);
    closing.append({ requestId, actor: options.actor, agent: "mdm-agent", decision: "no_tool_called", content: reply });
    closing.close();
  }

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

  const result = await runMdmAgent({
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
