/**
 * The orchestration layer. SPRINT3.md, 3.1. This is the seam SPRINT1.md and SPRINT2.md left as a
 * placeholder ("triage is not a separate process ... keep the routing logic as a placeholder
 * function so the seam exists"). It is now real, and every raw request the web app receives goes
 * through it before reaching an agent.
 *
 * routeRequest() classifies the request with triage.ts, writes exactly one routing-decision
 * record to its own audit chain (orchestrator-audit.ts), and — only for a real category — invokes
 * the matching agent with the raw request text, unchanged. Nothing triage produced is ever passed
 * to that agent as a parameter: the category picks which agent runs, and that is all it does.
 *
 * This module itself holds nothing worth stealing: no gateway, no Entra registration, no tools,
 * no credential beyond the ANTHROPIC_API_KEY the classifier call needs. Per SPRINT3.md's threat
 * model, a mis-route (whether from an ordinary misclassification or a prompt injection in the
 * request text) can only send a request to an agent that still holds its own credential, its own
 * gateway, and its own policy engine — all of which refuse it exactly as before. Triage cannot
 * widen what any agent is able to do.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ensureEnvLoaded } from "./env.js";
import { runEndpointAgent, type EndpointAgentResult } from "./endpoint-agent.js";
import { runIdentityAgent, type IdentityAgentResult } from "./identity-agent.js";
import { runKnowledgeAgent, type KnowledgeAgentResult } from "./knowledge-agent.js";
import { runMdmAgent, type MdmAgentResult } from "./mdm-agent.js";
import { OrchestratorAudit, type InvokedAgent } from "./orchestrator-audit.js";
import { createTriageClassifier, TriageError, type TriageClassifier } from "./triage.js";

type AgentInvocation<TResult> = (input: { actor: string; requestText: string; requestId: string; dbPath?: string }) => Promise<TResult>;

/** SPRINT3.md, follow-up to 3.1's mixed-domain finding: appended whenever triage flags part of
 * the request as outside whatever category it chose. The flag carries no data of its own — this
 * fixed sentence is the entirety of its effect, whether the request was routed or unsupported. */
const PARTIAL_SCOPE_NOTE = "Part of this request was not addressed above — please send it as a separate request.";

export interface RouteRequestOptions {
  actor: string;
  requestText: string;
  /** Generated if omitted. */
  requestId?: string;
  /** This orchestrator's own audit database. Default: data/orchestrator.db */
  dbPath?: string;
  /** Passed through to the identity agent when routed there. Default: its own. */
  identityDbPath?: string;
  /** Passed through to the MDM agent when routed there. Default: its own. */
  mdmDbPath?: string;
  /** Passed through to the knowledge agent when routed there. Default: its own. */
  knowledgeDbPath?: string;
  /** Passed through to the endpoint agent when routed there. Default: its own. */
  endpointDbPath?: string;
  /** Injectable for tests; defaults to a real classifier reading ANTHROPIC_API_KEY from the environment. */
  classify?: TriageClassifier["classify"];
  /** Injectable for tests; defaults to the real identity agent. */
  runIdentityAgent?: AgentInvocation<IdentityAgentResult>;
  /** Injectable for tests; defaults to the real MDM agent. */
  runMdmAgent?: AgentInvocation<MdmAgentResult>;
  /** Injectable for tests; defaults to the real knowledge agent. */
  runKnowledgeAgent?: AgentInvocation<KnowledgeAgentResult>;
  /** Injectable for tests; defaults to the real endpoint agent. */
  runEndpointAgent?: AgentInvocation<EndpointAgentResult>;
}

export type RouteRequestResult =
  | {
      status: "routed";
      category: "identity" | "mdm" | "knowledge" | "endpoint";
      agent: InvokedAgent;
      requestId: string;
      toolWasCalled: boolean;
      reply: string;
      /** Present only when triage flagged part of the request as outside this category. */
      note?: string;
    }
  | { status: "unsupported"; requestId: string; message: string; note?: string }
  | { status: "triage_failed"; requestId: string; message: string };

async function defaultClassify(requestText: string): Promise<Awaited<ReturnType<TriageClassifier["classify"]>>> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const model = process.env.HELPDESK_TRIAGE_MODEL;
  const classifier = createTriageClassifier({ apiKey, ...(model ? { model } : {}) });
  return classifier.classify(requestText);
}

export async function routeRequest(options: RouteRequestOptions): Promise<RouteRequestResult> {
  ensureEnvLoaded();

  const requestId = options.requestId ?? randomUUID();
  const dbPath = options.dbPath ?? resolve("data/orchestrator.db");
  const classify = options.classify ?? defaultClassify;
  const invokeIdentity = options.runIdentityAgent ?? runIdentityAgent;
  const invokeMdm = options.runMdmAgent ?? runMdmAgent;
  const invokeKnowledge = options.runKnowledgeAgent ?? runKnowledgeAgent;
  const invokeEndpoint = options.runEndpointAgent ?? runEndpointAgent;

  const audit = new OrchestratorAudit(dbPath);

  let classified: Awaited<ReturnType<TriageClassifier["classify"]>>;
  try {
    classified = await classify(options.requestText);
  } catch (error) {
    const rule = error instanceof TriageError && error.code === "invalid_output" ? "triage.invalid_output" : "triage.request_failed";
    const detail = error instanceof Error ? error.message : String(error);
    audit.appendNotRouted({ requestId, actor: options.actor, requestText: options.requestText, rule, detail });
    audit.close();
    return { status: "triage_failed", requestId, message: "Your request could not be classified right now. Please try again." };
  }

  audit.appendUsage({
    requestId,
    actor: options.actor,
    model: classified.model,
    inputTokens: classified.usage.inputTokens,
    outputTokens: classified.usage.outputTokens,
  });

  const note = classified.partiallyOutOfScope ? PARTIAL_SCOPE_NOTE : undefined;

  if (classified.category === "unsupported") {
    audit.appendNotRouted({ requestId, actor: options.actor, requestText: options.requestText, rule: "triage.unsupported" });
    audit.close();
    return {
      status: "unsupported",
      requestId,
      message: "This system doesn't have a way to help with that yet.",
      ...(note ? { note } : {}),
    };
  }

  const category = classified.category;
  const invokedAgent: InvokedAgent =
    category === "identity"
      ? "identity-agent"
      : category === "mdm"
        ? "mdm-agent"
        : category === "knowledge"
          ? "knowledge-agent"
          : "endpoint-agent";
  audit.appendRouted({ requestId, actor: options.actor, requestText: options.requestText, category, invokedAgent });
  audit.close();

  // requestId is this function's own, not the invoked agent's echo of it: both real agents
  // return the same value they were given, but the result type is built from `requestId`
  // directly so that guarantee lives here, not as an implicit contract on every agent.
  if (category === "identity") {
    const result = await invokeIdentity({
      actor: options.actor,
      requestText: options.requestText,
      requestId,
      ...(options.identityDbPath ? { dbPath: options.identityDbPath } : {}),
    });
    return {
      status: "routed",
      category: "identity",
      agent: "identity-agent",
      requestId,
      toolWasCalled: result.toolWasCalled,
      reply: result.reply,
      ...(note ? { note } : {}),
    };
  }

  if (category === "mdm") {
    const result = await invokeMdm({
      actor: options.actor,
      requestText: options.requestText,
      requestId,
      ...(options.mdmDbPath ? { dbPath: options.mdmDbPath } : {}),
    });
    return {
      status: "routed",
      category: "mdm",
      agent: "mdm-agent",
      requestId,
      toolWasCalled: result.toolWasCalled,
      reply: result.reply,
      ...(note ? { note } : {}),
    };
  }

  if (category === "knowledge") {
    const result = await invokeKnowledge({
      actor: options.actor,
      requestText: options.requestText,
      requestId,
      ...(options.knowledgeDbPath ? { dbPath: options.knowledgeDbPath } : {}),
    });
    return {
      status: "routed",
      category: "knowledge",
      agent: "knowledge-agent",
      requestId,
      toolWasCalled: result.toolWasCalled,
      reply: result.reply,
      ...(note ? { note } : {}),
    };
  }

  const result = await invokeEndpoint({
    actor: options.actor,
    requestText: options.requestText,
    requestId,
    ...(options.endpointDbPath ? { dbPath: options.endpointDbPath } : {}),
  });
  return {
    status: "routed",
    category: "endpoint",
    agent: "endpoint-agent",
    requestId,
    toolWasCalled: result.toolWasCalled,
    reply: result.reply,
    ...(note ? { note } : {}),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      actor: { type: "string" },
      request: { type: "string" },
      "request-id": { type: "string" },
      db: { type: "string" },
      "identity-db": { type: "string" },
      "mdm-db": { type: "string" },
      "knowledge-db": { type: "string" },
      "endpoint-db": { type: "string" },
    },
    strict: true,
  });
  if (!values.actor || !values.request) throw new Error("--actor and --request are required");

  const result = await routeRequest({
    actor: values.actor,
    requestText: values.request,
    ...(values["request-id"] ? { requestId: values["request-id"] } : {}),
    ...(values.db ? { dbPath: values.db } : {}),
    ...(values["identity-db"] ? { identityDbPath: values["identity-db"] } : {}),
    ...(values["mdm-db"] ? { mdmDbPath: values["mdm-db"] } : {}),
    ...(values["knowledge-db"] ? { knowledgeDbPath: values["knowledge-db"] } : {}),
    ...(values["endpoint-db"] ? { endpointDbPath: values["endpoint-db"] } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
