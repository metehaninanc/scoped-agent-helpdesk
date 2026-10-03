/**
 * The non-MCP HTTP endpoint the console calls to request a briefing on a pending approval
 * (SPRINT4.md, section 4). Same shape as gateway-core's own decision-listener.ts, deliberately not
 * shared with it: that file is gateway-neutral (both identity and endpoint use it for
 * approve/reject), while a briefing is identity-specific — the endpoint gateway has no
 * RationaleWorkflow to route to, and generalizing this thin a wrapper into gateway-core for one
 * caller would be the premature abstraction the project's own conventions argue against.
 * Authenticated the same way as `/approvals/decide`: a bearer token audience-bound to this
 * gateway, `Gateway.Invoke` required, on its own path — the JSON body here (approvalId,
 * requestedBy) is a genuine payload from the console's own human-only UI, not a model.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import type { AuditInput, AuditRecord } from "@helpdesk/audit-core";
import type { ApprovalRecord, TokenValidator } from "@helpdesk/gateway-core";

import { RationaleRequestError, type RationaleRequestErrorCode, type RationaleWorkflow } from "./rationale-workflow.js";

const MAX_BODY_BYTES = 64 * 1024;

const requestBodySchema = z.strictObject({
  approvalId: z.string().min(1),
  requestedBy: z.string().min(1),
});

export interface RationaleListenerDeps {
  workflow: Pick<RationaleWorkflow, "request">;
  validator: Pick<TokenValidator, "validate">;
  audit: { append(input: AuditInput): AuditRecord };
  /** The path this endpoint is served on. Default: "/approvals/rationale". */
  path?: string;
}

const STATUS_BY_ERROR_CODE: Record<RationaleRequestErrorCode, number> = {
  invalid_requester: 400,
  not_found: 404,
  not_pending: 409,
  already_generated: 409,
  generation_failed: 502,
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

export function createRationaleListener(deps: RationaleListenerDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const path = deps.path ?? "/approvals/rationale";

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

    const parsed = requestBodySchema.safeParse(body);
    if (!parsed.success) {
      respond(res, 400, { code: "malformed_request", message: "approvalId and requestedBy are both required." });
      return;
    }

    try {
      const approval: ApprovalRecord = await deps.workflow.request(parsed.data);
      respond(res, 200, approval);
    } catch (error) {
      if (error instanceof RationaleRequestError) {
        respond(res, STATUS_BY_ERROR_CODE[error.code], { code: error.code, message: error.message });
        return;
      }
      throw error;
    }
  };
}
