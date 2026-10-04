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
 * SPRINT4.md, section 1: triage now makes two decisions, not one. `classified.scope` is checked
 * first — `not_it`, `needs_human`, `network` and `security` all mean no agent runs, the same way
 * the old, single "unsupported" category did, but recorded as distinct, honestly-named outcomes
 * rather than one catch-all a reader could not tell apart. Only `routable` reaches decision two
 * (`classified.category`), which is exactly the four-category routing this file already did.
 *
 * `needs_human`, `network` and `security` are peers, and all three are handoffs, not refusals. The
 * difference is the reason recorded and, for `security`, the urgency: a security handoff is created
 * urgent and sorts above everything else in the operator queue whatever its age. A phishing report
 * where someone has already entered their password does not wait behind a broken dock.
 *
 * SPRINT4.md, section 2: `needs_human` now creates a real handoff — @helpdesk/handoff-core's
 * HandoffStore, sharing this file's own OrchestratorAudit connection (its own `log` is exposed
 * for exactly this). Built directly, with no gateway and no policy decision in between: this
 * module holds no credential and calls nothing external, so there is nothing for a policy engine
 * to decide here the way a gateway's own `hand_off` tool call still goes through one. The triage
 * decision itself is already audited on this chain (the `model_usage` record above, and now the
 * `handoff` record HandoffStore.create() appends); the handoff record is that decision
 * materialized into something an operator's queue can act on, not a second, separate judgment.
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

import { HandoffStore } from "@helpdesk/handoff-core";

import { ensureEnvLoaded } from "./env.js";
import { runEndpointAgent, type EndpointAgentResult } from "./endpoint-agent.js";
import { runIdentityAgent, type IdentityAgentResult } from "./identity-agent.js";
import { runKnowledgeAgent, type KnowledgeAgentResult } from "./knowledge-agent.js";
import { runMdmAgent, type MdmAgentResult } from "./mdm-agent.js";
import { OrchestratorAudit, type InvokedAgent } from "./orchestrator-audit.js";
import { createTriageClassifier, TriageError, type NotItTeam, type TriageClassifier } from "./triage.js";

type AgentInvocation<TResult> = (input: { actor: string; requestText: string; requestId: string; dbPath?: string }) => Promise<TResult>;

/** SPRINT3.md, follow-up to 3.1's mixed-domain finding: appended whenever triage flags part of
 * the request as outside whatever it decided. The flag carries no data of its own — this fixed
 * sentence is the entirety of its effect, whichever of the four result statuses it is added to. */
const PARTIAL_SCOPE_NOTE = "Part of this request was not addressed above — please send it as a separate request.";

/** SPRINT4.md, section 1: "The reply names the team that would own it where that is obvious."
 * Built here, from triage's closed-set `notItTeam`, never from anything triage wrote in prose —
 * the same discipline as PARTIAL_SCOPE_NOTE above, a fixed sentence per closed-set value, not
 * text the classifier composes. */
const NOT_IT_MESSAGE = "This system doesn't have a way to help with that — it isn't an IT matter this team handles.";
const NOT_IT_TEAM_MESSAGE: Record<NotItTeam, string> = {
  facilities: "This sounds like a facilities matter, not an IT one — please contact facilities directly.",
  hr: "This sounds like an HR matter, not an IT one — please contact HR directly.",
};

/** SPRINT4.md, section 1: genuinely IT, but needing hands, procurement, logistics, or an account
 * this system does not administer. As of section 2, this is a real, queued handoff — the message
 * still makes no promise about how soon, only that a person now has it. */
const NEEDS_HUMAN_MESSAGE = "This needs a person to help with it — it has been handed off and is waiting for an operator.";

/** The `reason` HandoffStore records for a handoff this file creates directly. Fixed, not
 * triage-composed: decision one's own closed set (SPRINT4.md, section 1) carries no more detail
 * than "needs_human" itself, so there is nothing more specific to say than this — the same
 * discipline as NOT_IT_MESSAGE/NOT_IT_TEAM_MESSAGE above, a canned sentence per closed-set value,
 * never text the classifier wrote. */
const NEEDS_HUMAN_REASON =
  "Classified by triage as needing a person: genuinely an IT matter, but requiring physical hands, procurement, logistics, or something outside this tenant entirely.";

/** `network`: connectivity and infrastructure — VPN tunnels, DNS, Wi-Fi, LAN, certificates, routing.
 * A handoff like `needs_human`'s, for a different reason: it needs someone with access to network
 * equipment, which is a different person from whoever fixes a laptop. Fixed text, the same
 * discipline as every message and reason above. */
const NETWORK_MESSAGE =
  "This is a network or connectivity matter that needs a person with access to network equipment — it has been handed off and is waiting for an operator.";
const NETWORK_REASON =
  "Classified by triage as a network or connectivity matter (VPN, DNS, Wi-Fi, LAN, certificates, routing): someone with access to network equipment has to look at it.";

/** `security`: a possible incident — suspected phishing, credentials entered on a fake page,
 * unexpected MFA prompts, a sign-in from an unknown device, a malware or ransomware alert. A
 * handoff, marked urgent. The message names no remedy and gives no advice: this module decides
 * where a request goes, not what a person should do about an incident. */
const SECURITY_MESSAGE = "This looks like a possible security matter. It has been handed to an operator and marked urgent.";
const SECURITY_REASON =
  "Classified by triage as a possible security incident (suspected phishing, credentials entered on a fake page, unexpected MFA prompts, a sign-in from an unknown device, a malware or ransomware alert). Marked urgent.";

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
  /** Not a corporate IT matter at all (SPRINT4.md, section 1) — the direct successor of the old,
   * single "unsupported" category, renamed because it is now one of two distinct non-routed
   * outcomes rather than the only one. */
  | { status: "not_it"; requestId: string; message: string; note?: string }
  /** Genuinely IT, but needing hands, procurement, logistics, or an account this system does not
   * administer (SPRINT4.md, section 1). handoffId names the real, queued record section 2 built
   * (@helpdesk/handoff-core's HandoffStore) — give it to the requester the same way a pending
   * approval's own id is given, so they have something to reference. */
  | { status: "needs_human"; requestId: string; handoffId: string; message: string; note?: string }
  /** Connectivity and infrastructure — a handoff for someone with access to network equipment. */
  | { status: "network"; requestId: string; handoffId: string; message: string; note?: string }
  /** A possible security incident — a handoff created urgent (`urgent` is always true here). */
  | { status: "security"; requestId: string; handoffId: string; message: string; urgent: true; note?: string }
  | { status: "triage_failed"; requestId: string; message: string; cause: string };

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
    // `cause` is for a batch caller's runStoppingReason() — never rendered to a requester (the
    // web app's request-page reads `message` only): a billing refusal or a 401 here is a standing
    // condition on the account, not a classification outcome, and swallowing it into this result
    // is what let a runner record every remaining ticket as triage_failed.
    return { status: "triage_failed", requestId, message: "Your request could not be classified right now. Please try again.", cause: detail };
  }

  audit.appendUsage({
    requestId,
    actor: options.actor,
    model: classified.model,
    inputTokens: classified.usage.inputTokens,
    outputTokens: classified.usage.outputTokens,
  });

  const note = classified.partiallyOutOfScope ? PARTIAL_SCOPE_NOTE : undefined;

  if (classified.scope === "not_it") {
    audit.appendNotRouted({
      requestId,
      actor: options.actor,
      requestText: options.requestText,
      rule: "triage.not_it",
      ...(classified.notItTeam ? { detail: classified.notItTeam } : {}),
    });
    audit.close();
    return {
      status: "not_it",
      requestId,
      message: classified.notItTeam ? NOT_IT_TEAM_MESSAGE[classified.notItTeam] : NOT_IT_MESSAGE,
      ...(note ? { note } : {}),
    };
  }

  if (classified.scope === "needs_human" || classified.scope === "network" || classified.scope === "security") {
    // No gateway, no policy decision: this module holds no credential and calls nothing
    // external, so there is nothing here for a policy engine to decide the way a gateway's own
    // hand_off tool call still goes through one (see the file header). HandoffStore shares this
    // request's own OrchestratorAudit connection, so the handoff record lands on the same chain,
    // in the same requestId, as the model_usage record already written above.
    const handoffs = new HandoffStore(audit.log.db, audit.log);
    const handoff = handoffs.create({
      requestId,
      actor: options.actor,
      requestText: options.requestText,
      createdBy: "orchestrator",
      reason: classified.scope === "security" ? SECURITY_REASON : classified.scope === "network" ? NETWORK_REASON : NEEDS_HUMAN_REASON,
      // Urgency comes from the closed-set scope and nothing else — never from words in the request.
      ...(classified.scope === "security" ? { urgent: true } : {}),
    });
    audit.close();
    if (classified.scope === "security") {
      return { status: "security", requestId, handoffId: handoff.id, message: SECURITY_MESSAGE, urgent: true, ...(note ? { note } : {}) };
    }
    return {
      status: classified.scope,
      requestId,
      handoffId: handoff.id,
      message: classified.scope === "network" ? NETWORK_MESSAGE : NEEDS_HUMAN_MESSAGE,
      ...(note ? { note } : {}),
    };
  }

  // TriageResult is a discriminated union on scope; both non-routable branches above already
  // returned, so TypeScript itself — not an assertion — knows category is non-null here.
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
