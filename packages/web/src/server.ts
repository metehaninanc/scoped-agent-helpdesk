/**
 * The HTTP layer. Plain node:http — no framework, no build pipeline (SPRINT1.md, Component 6).
 * Routing and body parsing live only here; every route handler above (request-page.ts,
 * approvals-page.ts) is a plain function tested without an HTTP server at all.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { ApprovalDecisionInput, ApprovalRecord } from "@helpdesk/gateway";

import { decideApproval, renderApprovalDetail, renderApprovalsList, type DecideDeps } from "./approvals-page.js";
import { page } from "./html.js";
import { renderRequestForm, submitRequest, type SubmitRequestDeps } from "./request-page.js";

export interface WebDeps extends SubmitRequestDeps, DecideDeps {
  listPendingApprovals: () => ApprovalRecord[];
  getApproval: (id: string) => ApprovalRecord | null;
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

  if (method === "GET" && url.pathname === "/approvals") {
    send(res, 200, page("Approvals", renderApprovalsList(deps.listPendingApprovals())));
    return;
  }

  const detailMatch = /^\/approvals\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && detailMatch) {
    const approval = deps.getApproval(detailMatch[1]!);
    if (!approval) return notFound(res);
    send(res, 200, page(`Approval ${approval.id}`, renderApprovalDetail(approval)));
    return;
  }

  const decideMatch = /^\/approvals\/([^/]+)\/decide$/.exec(url.pathname);
  if (method === "POST" && decideMatch) {
    const approvalId = decideMatch[1]!;
    const body = await readFormBody(req);
    const decision = body.get("decision");
    if (decision !== "approved" && decision !== "rejected") {
      return send(res, 400, page("Error", `<p class="error">decision must be "approved" or "rejected".</p>`));
    }
    const input: ApprovalDecisionInput = {
      approvalId,
      decidedBy: body.get("decidedBy") ?? "",
      decision,
      note: body.get("note") ?? "",
    };
    const result = await decideApproval(input, deps);
    const approval = deps.getApproval(approvalId);
    if (!approval) return notFound(res);
    send(res, 200, page(`Approval ${approval.id}`, renderApprovalDetail(approval, result)));
    return;
  }

  notFound(res);
}
