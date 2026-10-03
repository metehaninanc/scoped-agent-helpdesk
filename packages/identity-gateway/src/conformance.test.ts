/**
 * Runs @helpdesk/gateway-core's conformance suite against this gateway's own real wiring
 * (SPRINT3.md, 3.2): its own decide(), config, tool schemas and a fake Graph client, all wired
 * through createGatewayServer() and createRequestListener() exactly as bin/gateway.ts wires
 * them, so this proves the core's guarantees hold for THIS gateway's composition, not just for
 * gateway-core's own generic tests of runToolCall() and createRequestListener() in isolation.
 */
import { AuditLog } from "@helpdesk/audit-core";
import {
  ApprovalStore,
  TokenValidator,
  conformanceSuite,
  createRequestListener,
  openDatabase,
  type ConformanceHarness,
} from "@helpdesk/gateway-core";
import { HandoffStore } from "@helpdesk/handoff-core";

import { policyConfig } from "./policy/config.js";
import { createGatewayServer } from "./tools/server.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AUDIENCE = "api://helpdesk-identity-gateway";
const REQUIRED_ROLE = "Gateway.Invoke";

conformanceSuite("identity-gateway", (keys) => {
  const db = openDatabase(":memory:");
  const audit = new AuditLog(db);
  const auditCountWhenBackendTouched = { value: -1 };

  const server = createGatewayServer({
    audit,
    approvals: new ApprovalStore(db),
    handoffs: new HandoffStore(db, audit),
    config: policyConfig,
    graph: {
      listUserGroups: async () => {
        auditCountWhenBackendTouched.value = audit.list().length;
        return [];
      },
      addUserToGroup: async () => ({ alreadyMember: false }),
      removeUserFromGroup: async () => undefined,
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
    autonomousTool: { name: "list_user_groups", arguments: { userPrincipalName: "alice@contoso.com" } },
    malformedTool: { name: "list_user_groups", arguments: { userPrincipalName: "not a upn" } },
    unknownTool: "delete_user",
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
