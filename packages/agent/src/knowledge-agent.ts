/**
 * The knowledge agent. SPRINT3.md, 3.3. Same shape as identity-agent.ts and mdm-agent.ts, its
 * own file for the same reason theirs are separate from each other: the boundary between agents
 * comes from credentials and from each file simply never mentioning another gateway's tools, not
 * from a shared constant a runtime check has to keep honest.
 *
 * The one thing genuinely new about this agent: its own app registration carries the
 * Gateway.Invoke role on the knowledge gateway's API and, same as the other two agents, no Graph
 * permission at all — but unlike the other two, the *gateway* it talks to has no Graph
 * permission either, and no credential of its own whatsoever (SPRINT3.md, 3.3: "the gateway's
 * API permissions page in Entra is empty, which is the point"). This agent's own certificate is
 * the only credential anywhere in this path; it authenticates the agent to the gateway and to
 * nothing else, same guarantee as always.
 *
 * This process writes its own `request` and `no_tool_called` audit records, into the knowledge
 * gateway's own database file (data/knowledge-helpdesk.db by default) — its own chain, separate
 * from the other two agents', the same reasoning as always.
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

const GATEWAY_SERVER_NAME = "knowledge-gateway";
const GATEWAY_TOOLS = ["search_documentation"] as const;
/** KNOWLEDGE_GATEWAY_URL is the gateway's origin (no path), same convention as the other two. */
const GATEWAY_BASE_URL = process.env.KNOWLEDGE_GATEWAY_URL ?? "http://127.0.0.1:3003";
const GATEWAY_URL = `${GATEWAY_BASE_URL}/mcp`;

/** This agent's own credential env. Declared here, not shared with the other agents' (see file header). */
const agentCredentialEnvSchema = z.object({
  AZURE_TENANT_ID: z.guid(),
  AZURE_KNOWLEDGE_AGENT_CLIENT_ID: z.guid(),
  AZURE_KNOWLEDGE_AGENT_CERT_PATH: z.string().min(1),
  AZURE_KNOWLEDGE_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character hex SHA-1 thumbprint"),
  KNOWLEDGE_GATEWAY_AUDIENCE: z.string().min(1),
});

/** This agent's own certificate credential, and the audience it authenticates to. */
function loadAgentCredential(): { credential: CertificateCredential; audience: string } {
  const parsed = agentCredentialEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Knowledge agent's own credential environment is incomplete or malformed:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  const credential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_KNOWLEDGE_AGENT_CLIENT_ID,
    thumbprint: env.AZURE_KNOWLEDGE_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_KNOWLEDGE_AGENT_CERT_PATH),
  });
  return { credential, audience: env.KNOWLEDGE_GATEWAY_AUDIENCE };
}

/** See identity-agent.ts's buildSystemPrompt() for why this exists and what it does and does not
 * change — same reasoning, not repeated per file on purpose. This agent has no tool parameter
 * that would ever use it (search_documentation takes a query, not a user), but it is included for
 * the same reason every other part of this agent's shape mirrors the other three: consistency
 * across files a reviewer expects to look alike, not because this file has "add me" to resolve. */
function buildSystemPrompt(actor: string): string {
  return [
    "You are the knowledge agent. Your only job is to answer documentation and how-to questions",
    "about Microsoft Entra and Microsoft Intune, using only the search_documentation tool you have",
    "been given. You have no other tools and no other way to act on a request. You cannot look",
    "anything up in the tenant, change anything, or perform any action — you can only search a",
    "fixed set of documentation and report what it says.",
    "",
    `The person making this request is ${actor}. This is stated to you as a fact about who is`,
    "asking; you have no tool that takes a user as a parameter, so it should rarely matter, but it",
    "has no effect on what you are allowed to do either way — the gateway decides and audits every",
    "request from its own, independent record of who is asking.",
    "",
    "Every fact you state must be grounded in a passage search_documentation returned, and you",
    "must cite that passage's source document and heading when you state it. If the search comes",
    "back with no passages, or with passages that do not actually answer the question, say plainly",
    "that you don't know rather than answering from anything you know from your own training.",
    "Never claim to have performed an action, changed anything, or looked anything up in the",
    "tenant: you have not, and cannot.",
  ].join("\n");
}

/** Same shape as identity-agent.ts's RunQuery, declared again rather than imported (see file header). */
export type RunQuery = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface KnowledgeAgentOptions {
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

export interface KnowledgeAgentResult {
  requestId: string;
  toolWasCalled: boolean;
  reply: string;
}

async function mintAccessToken(): Promise<string> {
  const { credential, audience } = loadAgentCredential();
  const { token } = await credential.getToken(`${audience}/.default`);
  return token;
}

export async function runKnowledgeAgent(options: KnowledgeAgentOptions): Promise<KnowledgeAgentResult> {
  // Load .env now, before runQuery spawns the SDK's own subprocess. options.env is left unset
  // below, so that subprocess inherits process.env — this is what actually gets the key there.
  ensureEnvLoaded();

  const requestId = options.requestId ?? randomUUID();
  const dbPath = options.dbPath ?? resolve("data/knowledge-helpdesk.db");
  const runQuery = options.runQuery ?? query;
  const getAccessToken = options.getAccessToken ?? mintAccessToken;

  const opening = new SessionAudit(dbPath);
  opening.append({ requestId, actor: options.actor, agent: "knowledge-agent", decision: "request", content: options.requestText });
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
    closing.append({ requestId, actor: options.actor, agent: "knowledge-agent", decision: "no_tool_called", content: reply });
  }
  for (const [model, usage] of Object.entries(modelUsage)) {
    closing.appendUsage({ requestId, actor: options.actor, agent: "knowledge-agent", model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
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

  const result = await runKnowledgeAgent({
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
