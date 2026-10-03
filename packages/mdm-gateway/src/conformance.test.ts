/**
 * Runs @helpdesk/gateway-core's conformance suite against this gateway's own real wiring
 * (SPRINT3.md, 3.2) — see identity-gateway's conformance.test.ts for the full reasoning; this
 * file mirrors it for the MDM gateway's own decide(), config, tool schemas and a fake Graph
 * client, with no `onApproval` at all (this gateway has no write tools and no approval path).
 */
import { AuditLog } from "@helpdesk/audit-core";
import { TokenValidator, conformanceSuite, createRequestListener, openDatabase, type ConformanceHarness } from "@helpdesk/gateway-core";
import { HandoffStore } from "@helpdesk/handoff-core";

import { policyConfig } from "./policy/config.js";
import { createGatewayServer } from "./tools/server.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AUDIENCE = "api://helpdesk-mdm-gateway";
const REQUIRED_ROLE = "Gateway.Invoke";

conformanceSuite("mdm-gateway", (keys) => {
  const db = openDatabase(":memory:");
  const audit = new AuditLog(db);
  const handoffs = new HandoffStore(db, audit);
  const auditCountWhenBackendTouched = { value: -1 };

  const server = createGatewayServer({
    audit,
    config: policyConfig,
    handoffs,
    graph: {
      listDevices: async () => {
        auditCountWhenBackendTouched.value = audit.list().length;
        return [];
      },
      getDevice: async (id: string) => ({ id, displayName: "device", operatingSystem: "Windows", isCompliant: true }),
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
    autonomousTool: { name: "list_devices", arguments: {} },
    malformedTool: { name: "get_device", arguments: { deviceId: "not-a-guid" } },
    unknownTool: "delete_device",
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
