/**
 * The identity agent. SPRINT1.md, Component 5.
 *
 * Runs on the Claude Agent SDK with every built-in tool disabled (`tools: []`) and exactly
 * the three identity-gateway tools allowed. That is the whole point of using this SDK here
 * rather than Claude Code directly: Claude Code ships Bash, file write and web access by
 * default, and turning those off one at a time is a subtraction problem that needs
 * maintenance every release. `tools: []` plus a closed `allowedTools` list is the addition
 * problem instead — nothing runs unless it is named here.
 *
 * The actor identity is a spawn-time parameter of this process, passed straight through as a
 * command-line argument to the gateway subprocess. Nothing the model produces can set or
 * change it: there is no tool parameter, no prompt content, and no code path here that reads
 * an actor from anywhere but `options.actor`.
 *
 * This process, not the gateway, writes the `request` and `no_tool_called` audit records
 * (see session-audit.ts for why that file exists instead of importing the gateway's own
 * AuditLog): a `request` record before the model is ever called, and a `no_tool_called`
 * record if the whole session ends without the model calling a tool.
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { query, type McpServerConfig, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { ensureEnvLoaded } from "./env.js";
import { SessionAudit } from "./session-audit.js";

const GATEWAY_SERVER_NAME = "identity-gateway";
const GATEWAY_TOOLS = ["list_user_groups", "list_managed_groups", "add_user_to_group"] as const;

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
}

export interface IdentityAgentResult {
  requestId: string;
  toolWasCalled: boolean;
  reply: string;
}

/** Resolve the gateway's built entry point via its package.json, not by importing it. */
function gatewayEntryPoint(): string {
  const packageJsonPath = createRequire(import.meta.url).resolve("@helpdesk/gateway/package.json");
  return resolve(dirname(packageJsonPath), "dist", "bin", "gateway.js");
}

export async function runIdentityAgent(options: IdentityAgentOptions): Promise<IdentityAgentResult> {
  // Load .env now, before runQuery spawns the SDK's own subprocess. options.env is left unset
  // below, so that subprocess inherits process.env — this is what actually gets the key there.
  ensureEnvLoaded();

  const requestId = options.requestId ?? randomUUID();
  const dbPath = options.dbPath ?? resolve("data/helpdesk.db");
  const runQuery = options.runQuery ?? query;

  const opening = new SessionAudit(dbPath);
  opening.append({ requestId, actor: options.actor, agent: "identity-agent", decision: "request", content: options.requestText });
  opening.close();

  const mcpServers: Record<string, McpServerConfig> = {
    [GATEWAY_SERVER_NAME]: {
      type: "stdio",
      command: process.execPath,
      args: [
        gatewayEntryPoint(),
        "--actor",
        options.actor,
        "--agent",
        "identity-agent",
        "--request-id",
        requestId,
        "--db",
        dbPath,
      ],
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
    closing.append({ requestId, actor: options.actor, agent: "identity-agent", decision: "no_tool_called", content: reply });
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
