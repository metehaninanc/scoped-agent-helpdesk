/**
 * The non-MCP HTTP endpoint the web app calls to record and execute an approval decision
 * (SPRINT2.md, Stage B, Component 5). Deliberately not an MCP tool: approving or rejecting is a
 * human-only action, and putting it on the MCP tool surface would put it within an agent's
 * potential reach — exactly the separation of requester and approver the README already argues
 * for elsewhere. Authenticated the same way as the MCP endpoint (a bearer token audience-bound
 * to this gateway, Gateway.Invoke required) but on its own path and its own listener: the JSON
 * body here (approvalId, decidedBy, decision, note) is the genuine request payload, filled in by
 * a human on a human-only interface, not a model, so there is no "identity from the body"
 * concern the MCP path has to guard against.
 *
 * ApprovalWorkflow itself is unchanged: this file only moves where it runs (inside the gateway
 * process, which already holds the Graph client) and how it is reached (an authenticated HTTP
 * call from the web app, which no longer holds a Graph credential of its own at all).
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";

import type { TokenValidator } from "../auth/verify-token.js";
import { ApprovalError, type ApprovalErrorCode, type ApprovalWorkflow } from "./workflow.js";

const MAX_BODY_BYTES = 64 * 1024;

const decisionBodySchema = z.strictObject({
  approvalId: z.string().min(1),
  decidedBy: z.string().min(1),
  decision: z.union([z.literal("approved"), z.literal("rejected")]),
  note: z.string(),
});

export interface DecisionListenerDeps {
  workflow: Pick<ApprovalWorkflow, "decide">;
  validator: Pick<TokenValidator, "validate">;
  audit: { append(input: AuditInput): AuditRecord };
  /** The path this endpoint is served on. Default: "/approvals/decide". */
  path?: string;
}

const STATUS_BY_ERROR_CODE: Record<ApprovalErrorCode, number> = {
  invalid_approver: 400,
  invalid_decision: 400,
  note_required: 400,
  not_found: 404,
  not_pending: 409,
  self_approval: 403,
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > 0 ? JSON.parse(text) : {};
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createDecisionListener(deps: DecisionListenerDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const path = deps.path ?? "/approvals/decide";

  return async (req, res) => {
    if (req.method !== "POST" || req.url !== path) {
      res.writeHead(404).end();
      return;
    }

    const result = await deps.validator.validate(req.headers.authorization);
    if (!result.ok) {
      deps.audit.append({
        requestId: randomUUID(),
        actor: "unknown",
        agent: "unknown",
        tool: null,
        parameters: { authorizationHeaderPresent: req.headers.authorization !== undefined },
        decision: "denied",
        rules: [`deny.${result.reason}`],
      });
      respond(res, 401, { code: `token_${result.reason}`, message: "Bearer token rejected." });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      respond(res, 400, { code: "malformed_request", message: "Request body must be valid JSON, under 64KB." });
      return;
    }

    const parsed = decisionBodySchema.safeParse(body);
    if (!parsed.success) {
      respond(res, 400, { code: "malformed_request", message: "approvalId, decidedBy, decision and note are all required." });
      return;
    }

    try {
      const outcome = await deps.workflow.decide(parsed.data);
      respond(res, 200, outcome);
    } catch (error) {
      if (error instanceof ApprovalError) {
        respond(res, STATUS_BY_ERROR_CODE[error.code], { code: error.code, message: error.message });
        return;
      }
      throw error;
    }
  };
}
