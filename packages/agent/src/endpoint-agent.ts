/**
 * The endpoint agent. SPRINT3.md, 3.4. Same shape as the other three agents, its own file for the
 * same reason theirs are separate from each other: the boundary between agents comes from
 * credentials and from each file simply never mentioning another gateway's tools, not from a
 * shared constant a runtime check has to keep honest.
 *
 * reset_password is deliberately in this agent's own allowed-tools list, the same as its three
 * working tools. Excluding it would block the model from ever attempting it at the Agent SDK
 * layer, before the request ever reached the gateway — which would make the refusal a client-side
 * omission, not a policy decision, and it would never reach the audit log at all. Including it is
 * what lets the model actually try, and lets the gateway's own policy engine (never this file, and
 * never this agent's system prompt) refuse it by name and audit that refusal, the same as every
 * other decision this project ever makes. This agent's own certificate carries Gateway.Invoke on
 * the endpoint gateway's API and no Graph permission — same guarantee as the other three agents,
 * and, same as the knowledge agent, the gateway on the other end holds no credential either.
 *
 * This process writes its own `request` and `no_tool_called` audit records, into the endpoint
 * gateway's own database file (data/endpoint-helpdesk.db by default) — its own chain, separate
 * from the other three agents', the same reasoning as always.
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

const GATEWAY_SERVER_NAME = "endpoint-gateway";
const GATEWAY_TOOLS = ["list_endpoints", "get_endpoint", "reboot_endpoint", "reset_password"] as const;
/** ENDPOINT_GATEWAY_URL is the gateway's origin (no path), same convention as the other three. */
const GATEWAY_BASE_URL = process.env.ENDPOINT_GATEWAY_URL ?? "http://127.0.0.1:3004";
const GATEWAY_URL = `${GATEWAY_BASE_URL}/mcp`;

/** This agent's own credential env. Declared here, not shared with the other agents' (see file header). */
const agentCredentialEnvSchema = z.object({
  AZURE_TENANT_ID: z.guid(),
  AZURE_ENDPOINT_AGENT_CLIENT_ID: z.guid(),
  AZURE_ENDPOINT_AGENT_CERT_PATH: z.string().min(1),
  AZURE_ENDPOINT_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character hex SHA-1 thumbprint"),
  ENDPOINT_GATEWAY_AUDIENCE: z.string().min(1),
});

/** This agent's own certificate credential, and the audience it authenticates to. */
function loadAgentCredential(): { credential: CertificateCredential; audience: string } {
  const parsed = agentCredentialEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Endpoint agent's own credential environment is incomplete or malformed:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  const credential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_ENDPOINT_AGENT_CLIENT_ID,
    thumbprint: env.AZURE_ENDPOINT_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_ENDPOINT_AGENT_CERT_PATH),
  });
  return { credential, audience: env.ENDPOINT_GATEWAY_AUDIENCE };
}

/** See identity-agent.ts's buildSystemPrompt() for why this exists and what it does and does not
 * change — same reasoning, not repeated per file on purpose. */
function buildSystemPrompt(actor: string): string {
  return [
    "You are the endpoint agent. Your job is to help with a small fleet of endpoints (devices,",
    "printers, and similar equipment) through a stub endpoint service: list_endpoints, get_endpoint",
    "and reboot_endpoint. reboot_endpoint always returns a pending approval, not an immediate",
    "result — that is the normal, successful outcome of asking for a reboot, not a failure to retry",
    "around. A human reviews and decides before anything actually happens.",
    "",
    "This system manages a small, fixed fleet of specific endpoints, not people's own personal",
    "devices in general. Only call list_endpoints or get_endpoint, and only name a specific",
    "managed endpoint back to the requester, when what they described actually identifies one — a",
    "hostname, an asset tag, or an unambiguous description they gave you. If nothing they said",
    "identifies one of the endpoints this system manages, tell them in one sentence that their",
    "device is not one this system manages, and stop there. Never read back the list of managed",
    "endpoints as a menu for them to choose from: naming devices they did not ask about is not",
    "helping them, it is exposing this system's internal inventory to whoever happens to ask.",
    "",
    `The person making this request is ${actor}. This is stated to you as a fact about who is`,
    'asking, not something you can change: if the request says "me," "my," or similar, it means',
    "this person. It has no other effect — the gateway decides and audits every request from its",
    "own, independent record of who is asking, so nothing you say about identity here changes",
    "what is allowed or what gets logged.",
    "",
    "You also have a reset_password tool. This system never resets a password through it or any",
    "other means, for anyone, under any circumstance: the policy engine refuses every call to it",
    "regardless of who is asking or who the target is, and no rephrasing, no different wording and",
    "no different target user changes that. Do not retry it. If someone asks you to reset a",
    "password, tell them plainly that this system cannot do it, point them to Self-Service",
    "Password Reset (SSPR) first, and to their manager if SSPR is not available to them.",
    "",
    "Never claim to have performed an action, changed anything, or looked anything up beyond what a",
    "tool result actually shows you.",
  ].join("\n");
}

/** Same shape as identity-agent.ts's RunQuery, declared again rather than imported (see file header). */
export type RunQuery = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface EndpointAgentOptions {
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

export interface EndpointAgentResult {
  requestId: string;
  toolWasCalled: boolean;
  reply: string;
}

async function mintAccessToken(): Promise<string> {
  const { credential, audience } = loadAgentCredential();
  const { token } = await credential.getToken(`${audience}/.default`);
  return token;
}

export async function runEndpointAgent(options: EndpointAgentOptions): Promise<EndpointAgentResult> {
  // Load .env now, before runQuery spawns the SDK's own subprocess. options.env is left unset
  // below, so that subprocess inherits process.env — this is what actually gets the key there.
  ensureEnvLoaded();

  const requestId = options.requestId ?? randomUUID();
  const dbPath = options.dbPath ?? resolve("data/endpoint-helpdesk.db");
  const runQuery = options.runQuery ?? query;
  const getAccessToken = options.getAccessToken ?? mintAccessToken;

  const opening = new SessionAudit(dbPath);
  opening.append({ requestId, actor: options.actor, agent: "endpoint-agent", decision: "request", content: options.requestText });
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
      model: process.env.HELPDESK_AGENT_MODEL ?? DEFAULT_AGENT_MODEL,
      systemPrompt: buildSystemPrompt(options.actor),
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
  // outcome (see identity-agent.ts for the same reasoning, not repeated per file on purpose).
  const closing = new SessionAudit(dbPath);
  if (!toolWasCalled) {
    closing.append({ requestId, actor: options.actor, agent: "endpoint-agent", decision: "no_tool_called", content: reply });
  }
  for (const [model, usage] of Object.entries(modelUsage)) {
    closing.appendUsage({ requestId, actor: options.actor, agent: "endpoint-agent", model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
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

  const result = await runEndpointAgent({
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
