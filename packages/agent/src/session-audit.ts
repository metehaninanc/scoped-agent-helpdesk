/**
 * The two audit records the identity agent is responsible for. SPRINT1.md, Component 5:
 *
 *   "Every agent session writes a request record at start under its requestId, and a
 *    no_tool_called record if it ends without calling a tool."
 *
 * Written with the real @helpdesk/audit-core AuditLog — the same class the gateway uses on
 * the same file — so there is exactly one implementation of the record format and the hash
 * chain, not two that happen to agree today. (An earlier version of this file duplicated that
 * logic, before the shared package existed; see the audit-core package README for why that
 * duplication was worth removing.)
 *
 * This file exists at all, instead of the agent calling into the gateway for these two writes,
 * because SPRINT1.md forbids the agent package from importing gateway runtime code, and only
 * this process ever sees the model's final reply text, which the no_tool_called record needs.
 * @helpdesk/audit-core is not gateway code — it is the shared package both writers depend on.
 */
import { AuditLog } from "@helpdesk/audit-core";

import { openDatabase } from "./db.js";

export interface SessionAuditInput {
  requestId: string;
  actor: string;
  agent: string;
  decision: "request" | "no_tool_called";
  /** The request text on a `request` record; the agent's final reply on `no_tool_called`. */
  content: unknown;
}

export class SessionAudit {
  private readonly log: AuditLog;

  constructor(dbPath: string) {
    this.log = new AuditLog(openDatabase(dbPath));
  }

  append(input: SessionAuditInput): void {
    this.log.append({
      requestId: input.requestId,
      actor: input.actor,
      agent: input.agent,
      tool: null,
      decision: input.decision,
      parameters: input.decision === "request" ? input.content : null,
      rules: [],
      result: input.decision === "no_tool_called" ? input.content : null,
    });
  }

  close(): void {
    this.log.close();
  }
}
