/**
 * Runs @helpdesk/gateway-core's conformance suite against this gateway's own real wiring
 * (SPRINT3.md, 3.4) — see identity-gateway's conformance.test.ts for the full reasoning. Like the
 * knowledge gateway's harness, this one has no Graph client to fake; unlike it, this gateway does
 * have an approval path (reboot_endpoint), so its own approvals store is real, not absent.
 */
import { AuditLog } from "@helpdesk/audit-core";
import { ApprovalStore, TokenValidator, conformanceSuite, createRequestListener, openDatabase, type ConformanceHarness } from "@helpdesk/gateway-core";
import { HandoffStore } from "@helpdesk/handoff-core";

import { policyConfig } from "./policy/config.js";
import { createEndpointService } from "./stub/endpoint-service.js";
import { createGatewayServer } from "./tools/server.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AUDIENCE = "api://helpdesk-endpoint-gateway";
const REQUIRED_ROLE = "Gateway.Invoke";
const ENDPOINT = "ep-front-desk-01";

conformanceSuite("endpoint-gateway", (keys) => {
  const db = openDatabase(":memory:");
  const audit = new AuditLog(db);
  const approvals = new ApprovalStore(db);
  const handoffs = new HandoffStore(db, audit);
  const auditCountWhenBackendTouched = { value: -1 };

  const stub = createEndpointService({ seed: [{ id: ENDPOINT, hostname: "front-desk-01", status: "online", lastCheckInAt: "2026-09-19T00:00:00.000Z" }] });
  const server = createGatewayServer({
    audit,
    approvals,
    handoffs,
    config: policyConfig,
    stub: {
      ...stub,
      getEndpoint: async (id: string) => {
        auditCountWhenBackendTouched.value = audit.list().length;
        return stub.getEndpoint(id);
      },
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
    autonomousTool: { name: "get_endpoint", arguments: { endpointId: ENDPOINT } },
    malformedTool: { name: "get_endpoint", arguments: {} },
    unknownTool: "delete_endpoint",
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
