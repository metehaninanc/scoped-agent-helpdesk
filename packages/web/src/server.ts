/**
 * The HTTP layer. Plain node:http — no framework, no build pipeline (SPRINT1.md, Component 6).
 * Routing and body parsing live only here; every route handler above (request-page.ts,
 * console-page.ts) is a plain function tested without an HTTP server at all.
 *
 * SPRINT4.md, section 3: the operator console replaces the old /approvals pages entirely — one
 * page, both queues, at /console, with each opened item at /console/approvals/:id or
 * /console/handoffs/:id. There is deliberately no /approvals route left behind.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { ApprovalRecord } from "@helpdesk/gateway-core";
import type { HandoffRecord } from "@helpdesk/handoff-core";

import { approvalRow, handoffRow, rawRequestText, sortQueue, type TrailRecord } from "./console-data.js";
import {
  decideApproval,
  renderApprovalDetail,
  renderConsole,
  renderHandoffDetail,
  requestRationale,
  resolveHandoff,
  takeHandoff,
  type DecideApprovalDeps,
  type RationaleActionResult,
  type RequestRationaleDeps,
} from "./console-page.js";
import type { DashboardData } from "./dashboard-metrics.js";
import { renderDashboard } from "./dashboard-page.js";
import { page } from "./html.js";
import { renderRequestForm, submitRequest, type SubmitRequestDeps } from "./request-page.js";

export interface WebDeps extends SubmitRequestDeps, DecideApprovalDeps, RequestRationaleDeps {
  listPendingApprovals: () => ApprovalRecord[];
  getApproval: (id: string) => ApprovalRecord | null;
  listActiveHandoffs: () => HandoffRecord[];
  getHandoff: (id: string) => HandoffRecord | null;
  takeHandoff: (id: string, takenBy: string) => HandoffRecord;
  resolveHandoff: (id: string, resolvedBy: string, note: string) => HandoffRecord;
  /** Every audit record across all five chains carrying this request id, oldest first — see
   * console-data.ts's getRequestTrail() for how a caller builds this. */
  getRequestTrail: (requestId: string) => TrailRecord[];
  /** Re-reads and re-verifies all five chains and recomputes every number — see
   * dashboard-metrics.ts's header comment for why this is called fresh on every request rather
   * than cached. */
  getDashboardData: () => DashboardData;
}

const MAX_BODY_BYTES = 64 * 1024;

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function notFound(res: ServerResponse): void {
  send(res, 404, page("Not found", "<h1>Not found</h1>"));
}

export function createWebServer(deps: WebDeps) {
  return createServer((req, res) => {
    void handle(req, res, deps).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      send(res, 500, page("Error", `<h1>Error</h1><p class="error">${message}</p>`));
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: WebDeps): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/") {
    send(res, 200, page("Request", renderRequestForm()));
    return;
  }

  if (method === "POST" && url.pathname === "/") {
    const body = await readFormBody(req);
    const formValues = { actor: body.get("actor") ?? "", requestText: body.get("requestText") ?? "" };
    const result = await submitRequest(formValues, deps);
    send(res, 200, page("Request", renderRequestForm(result, formValues)));
    return;
  }

  if (method === "GET" && url.pathname === "/console") {
    const now = new Date();
    const approvalRows = sortQueue(deps.listPendingApprovals().map((a) => approvalRow(a, now)));
    const handoffRows = sortQueue(deps.listActiveHandoffs().map((h) => handoffRow(h, now)));
    send(res, 200, page("Operator console", renderConsole(approvalRows, handoffRows)));
    return;
  }

  if (method === "GET" && url.pathname === "/dashboard") {
    send(res, 200, page("Dashboard", renderDashboard(deps.getDashboardData())));
    return;
  }

  const approvalDetailMatch = /^\/console\/approvals\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && approvalDetailMatch) {
    const approval = deps.getApproval(approvalDetailMatch[1]!);
    if (!approval) return notFound(res);
    const trail = deps.getRequestTrail(approval.requestId);
    send(res, 200, page(`Approval ${approval.id}`, renderApprovalDetail(approval, trail, rawRequestText(trail))));
    return;
  }

  const approvalDecideMatch = /^\/console\/approvals\/([^/]+)\/decide$/.exec(url.pathname);
  if (method === "POST" && approvalDecideMatch) {
    const approvalId = approvalDecideMatch[1]!;
    const body = await readFormBody(req);
    const decision = body.get("decision");
    if (decision !== "approved" && decision !== "rejected") {
      return send(res, 400, page("Error", `<p class="error">decision must be "approved" or "rejected".</p>`));
    }
    const result = await decideApproval({ approvalId, decidedBy: body.get("decidedBy") ?? "", decision, note: body.get("note") ?? "" }, deps);
    const approval = deps.getApproval(approvalId);
    if (!approval) return notFound(res);
    const trail = deps.getRequestTrail(approval.requestId);
    send(res, 200, page(`Approval ${approval.id}`, renderApprovalDetail(approval, trail, rawRequestText(trail), result)));
    return;
  }

  const approvalRationaleMatch = /^\/console\/approvals\/([^/]+)\/rationale$/.exec(url.pathname);
  if (method === "POST" && approvalRationaleMatch) {
    const approvalId = approvalRationaleMatch[1]!;
    const body = await readFormBody(req);
    const result: RationaleActionResult = await requestRationale({ approvalId, requestedBy: body.get("requestedBy") ?? "" }, deps);
    const approval = deps.getApproval(approvalId);
    if (!approval) return notFound(res);
    const trail = deps.getRequestTrail(approval.requestId);
    send(res, 200, page(`Approval ${approval.id}`, renderApprovalDetail(approval, trail, rawRequestText(trail), undefined, result)));
    return;
  }

  const handoffDetailMatch = /^\/console\/handoffs\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && handoffDetailMatch) {
    const handoff = deps.getHandoff(handoffDetailMatch[1]!);
    if (!handoff) return notFound(res);
    const trail = deps.getRequestTrail(handoff.requestId);
    send(res, 200, page(`Handoff ${handoff.id}`, renderHandoffDetail(handoff, trail)));
    return;
  }

  const handoffTakeMatch = /^\/console\/handoffs\/([^/]+)\/take$/.exec(url.pathname);
  if (method === "POST" && handoffTakeMatch) {
    const handoffId = handoffTakeMatch[1]!;
    const body = await readFormBody(req);
    const result = takeHandoff(handoffId, body.get("takenBy") ?? "", { take: deps.takeHandoff });
    const handoff = deps.getHandoff(handoffId);
    if (!handoff) return notFound(res);
    const trail = deps.getRequestTrail(handoff.requestId);
    send(res, 200, page(`Handoff ${handoff.id}`, renderHandoffDetail(handoff, trail, result)));
    return;
  }

  const handoffResolveMatch = /^\/console\/handoffs\/([^/]+)\/resolve$/.exec(url.pathname);
  if (method === "POST" && handoffResolveMatch) {
    const handoffId = handoffResolveMatch[1]!;
    const body = await readFormBody(req);
    const result = resolveHandoff(handoffId, body.get("resolvedBy") ?? "", body.get("note") ?? "", { resolve: deps.resolveHandoff });
    const handoff = deps.getHandoff(handoffId);
    if (!handoff) return notFound(res);
    const trail = deps.getRequestTrail(handoff.requestId);
    send(res, 200, page(`Handoff ${handoff.id}`, renderHandoffDetail(handoff, trail, result)));
    return;
  }

  notFound(res);
}
