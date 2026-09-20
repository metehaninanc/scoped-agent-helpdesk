/**
 * The orchestration layer's own audit chain. SPRINT3.md, 3.1:
 *
 *   "The routing decision is audited by the orchestration layer, not by triage... Triage never
 *    writes to an agent's audit chain."
 *
 * A third database, alongside the identity and MDM gateways' own (SPRINT2.md, Component 6: two
 * gateways, two chains, never merged, so a compromise of one cannot rewrite the other's
 * history). The same reasoning adds a third chain here rather than folding routing records into
 * whichever agent's chain a request happens to land on: the orchestration layer sees every
 * request before any agent does, so it is the one component whose chain must not be a chain any
 * single agent could rewrite, and vice versa.
 *
 * Every record here carries the same requestId the invoked agent's own chain uses for the rest
 * of that request, so a reader can follow one request across two files the same way Sprint 2's
 * cross-gateway checks already do — a merge by requestId, not a merged table.
 */
import { AuditLog } from "@helpdesk/audit-core";

import { openDatabase } from "./db.js";

const AGENT_NAME = "orchestrator";

export type InvokedAgent = "identity-agent" | "mdm-agent" | "knowledge-agent" | "endpoint-agent";

export interface RoutedInput {
  requestId: string;
  actor: string;
  requestText: string;
  category: "identity" | "mdm" | "knowledge" | "endpoint";
  invokedAgent: InvokedAgent;
}

/**
 * triage.unsupported    - triage classified the request into the closed set's explicit "none of
 *                         these" value.
 * triage.invalid_output - triage responded, but not with a value in the closed set.
 * triage.request_failed - the classification call itself did not complete (network, API error,
 *                         a bad stop reason, or misconfiguration).
 */
export type TriageFailureRule = "triage.unsupported" | "triage.invalid_output" | "triage.request_failed";

export interface NotRoutedInput {
  requestId: string;
  actor: string;
  requestText: string;
  rule: TriageFailureRule;
  /** The error message, when there is one worth keeping. Never the request's own text twice over. */
  detail?: string;
}

export interface UsageInput {
  requestId: string;
  actor: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export class OrchestratorAudit {
  private readonly log: AuditLog;

  constructor(dbPath: string) {
    this.log = new AuditLog(openDatabase(dbPath));
  }

  /** A category was classified and an agent invoked. */
  appendRouted(input: RoutedInput): void {
    this.log.append({
      requestId: input.requestId,
      actor: input.actor,
      agent: AGENT_NAME,
      tool: null,
      decision: "routed",
      parameters: { requestText: input.requestText, category: input.category },
      rules: [],
      result: { invokedAgent: input.invokedAgent },
    });
  }

  /** No agent was invoked: an explicit "unsupported" classification, or triage itself failed. */
  appendNotRouted(input: NotRoutedInput): void {
    this.log.append({
      requestId: input.requestId,
      actor: input.actor,
      agent: AGENT_NAME,
      tool: null,
      decision: "denied",
      parameters: { requestText: input.requestText, ...(input.detail !== undefined ? { detail: input.detail } : {}) },
      rules: [input.rule],
      result: null,
    });
  }

  /** Triage's own classification call. Agents record their own turns; see session-audit.ts. */
  appendUsage(input: UsageInput): void {
    this.log.append({
      requestId: input.requestId,
      actor: input.actor,
      agent: AGENT_NAME,
      tool: null,
      decision: "model_usage",
      parameters: null,
      rules: [],
      result: { model: input.model, inputTokens: input.inputTokens, outputTokens: input.outputTokens },
    });
  }

  close(): void {
    this.log.close();
  }
}
