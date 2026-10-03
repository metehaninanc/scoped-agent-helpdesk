/**
 * Runs @helpdesk/gateway-core's conformance suite against this gateway's own real wiring
 * (SPRINT3.md, 3.3) — see identity-gateway's conformance.test.ts for the full reasoning. This is
 * the gateway with no credential and no backend client, so its harness is the simplest of the
 * three: no Graph client to fake, no approvals to wire, just the real corpus search standing in
 * for "the backend."
 */
import { AuditLog } from "@helpdesk/audit-core";
import { TokenValidator, conformanceSuite, createRequestListener, openDatabase, type ConformanceHarness } from "@helpdesk/gateway-core";
import { HandoffStore } from "@helpdesk/handoff-core";

import { corpusRawDir, loadCorpus } from "./corpus.js";
import { policyConfig } from "./policy/config.js";
import { createDocumentationSearch } from "./search.js";
import { createGatewayServer } from "./tools/server.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AUDIENCE = "api://helpdesk-knowledge-gateway";
const REQUIRED_ROLE = "Gateway.Invoke";

const documentationSearch = createDocumentationSearch(loadCorpus(corpusRawDir()));

conformanceSuite("knowledge-gateway", (keys) => {
  const db = openDatabase(":memory:");
  const audit = new AuditLog(db);
  const handoffs = new HandoffStore(db, audit);
  const auditCountWhenBackendTouched = { value: -1 };

  const server = createGatewayServer({
    audit,
    config: policyConfig,
    handoffs,
    search: (query: string) => {
      auditCountWhenBackendTouched.value = audit.list().length;
      return documentationSearch.search(query);
    },
  });

  const validator = new TokenValidator({ tenantId: TENANT_ID, audience: AUDIENCE, requiredRole: REQUIRED_ROLE, jwks: keys.jwks });
  const listener = createRequestListener({
    createTransport: async () => ({ handleRequest: async () => undefined }),
    validator,
    audit,
  });

  const harness: ConformanceHarness = {
    server,
    audit,
    autonomousTool: { name: "search_documentation", arguments: { query: "groups" } },
    malformedTool: { name: "search_documentation", arguments: {} },
    unknownTool: "delete_documentation",
    auditCountWhenBackendTouched,
    listener,
    listenerAudit: audit,
    tenantId: TENANT_ID,
    audience: AUDIENCE,
    requiredRole: REQUIRED_ROLE,
    cleanup: () => audit.close(),
  };
  return harness;
});
