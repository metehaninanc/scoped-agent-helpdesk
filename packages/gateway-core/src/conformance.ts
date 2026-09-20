/**
 * The conformance suite. SPRINT3.md, 3.2: "Write a conformance test suite in the core package
 * that any gateway can run against itself... Then run it against all four gateways. A template
 * whose guarantees are only described is a convention. One whose guarantees are tested is a
 * template."
 *
 * Five checks, each proving one guarantee this package makes on every gateway's behalf:
 *
 *   - the audit record for a decision is committed before that gateway's backend is touched
 *   - an unknown tool name is denied and audited
 *   - malformed input is denied and audited, never thrown
 *   - a request with no bearer token is refused with 401, audited
 *   - a request bearing a token for a different audience is refused
 *
 * The first three exercise a gateway's own `createGatewayServer()` result directly, over an
 * in-memory MCP transport (`InMemoryTransport` + a real `Client`) — real JSON-RPC round trips,
 * no HTTP needed, the same mechanism each gateway's own server.test.ts already uses. The last
 * two exercise a gateway's own `createRequestListener()` result, the same way http-listener.ts's
 * own tests do: a real `TokenValidator`, a real signed JWT, a faked transport (auth failures
 * never reach it).
 *
 * A gateway proves conformance by building a `ConformanceHarness` from its own real wiring —
 * its own `decide`, `config`, tool schemas and backend, wired through a fresh in-memory audit
 * log — and handing it to `conformanceSuite()`. Nothing here inspects a gateway's tool names,
 * policy rules or backend; it only proves the shape every gateway shares.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuditRecord } from "@helpdesk/audit-core";
import { describe, expect, it } from "vitest";

import { createTestSigningKeys, type TestSigningKeys } from "./testing.js";

export interface ConformanceHarness {
  /** This gateway's own MCP server (createGatewayServer-based), wired with its real decide/
   * config/parse/execute and a fresh in-memory audit log. */
  server: Server;
  /** The audit log `server` writes to. */
  audit: { list(): AuditRecord[] };
  /** A tool name + arguments this gateway serves that is autonomous (no approval) and touches
   * its backend. `list_user_groups` / `list_devices`-shaped. */
  autonomousTool: { name: string; arguments: Record<string, unknown> };
  /** A tool name this gateway serves, with arguments that fail its own parameter schema. */
  malformedTool: { name: string; arguments: Record<string, unknown> };
  /** A tool name this gateway does not recognize at all. */
  unknownTool: string;
  /** Set by this harness's own backend fake to the number of audit records that existed at the
   * moment the backend was actually called. Left at -1 if the backend is never touched. Only the
   * gateway knows what "touching the backend" means, so only it can wire this. */
  auditCountWhenBackendTouched: { value: number };

  /** This gateway's own HTTP listener (createRequestListener-based), for the auth-gating checks. */
  listener: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** The audit log `listener` writes refusals to. May be the same instance as `audit`. */
  listenerAudit: { list(): AuditRecord[] };
  /** This gateway's own tenant, audience and required role, so the suite can sign tokens the
   * harness's own TokenValidator will actually accept or refuse. */
  tenantId: string;
  audience: string;
  requiredRole: string;
  /** Release anything the harness opened (an in-memory sqlite handle, ...). */
  cleanup?: () => void;
}

type BuildHarness = (keys: TestSigningKeys) => ConformanceHarness | Promise<ConformanceHarness>;

function fakeReq(headers: Record<string, string | string[] | undefined>): IncomingMessage {
  return { url: "/mcp", headers } as unknown as IncomingMessage;
}

interface FakeResponse {
  statusCode: number | undefined;
  body: string | undefined;
}

function fakeRes(): ServerResponse & FakeResponse {
  const res: FakeResponse & { writeHead: unknown; end: unknown } = {
    statusCode: undefined,
    body: undefined,
    writeHead(status: number) {
      res.statusCode = status;
      return res;
    },
    end(body?: string) {
      res.body = body;
    },
  };
  return res as unknown as ServerResponse & FakeResponse;
}

async function connectClient(server: Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "conformance-suite", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first!.text) as Record<string, unknown>;
}

const validClaims = (
  harness: Pick<ConformanceHarness, "tenantId" | "audience" | "requiredRole">,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  aud: harness.audience,
  iss: `https://login.microsoftonline.com/${harness.tenantId}/v2.0`,
  exp: Math.floor(Date.now() / 1000) + 3600,
  roles: [harness.requiredRole],
  azp: "conformance-test-agent",
  ...overrides,
});

export function conformanceSuite(gatewayName: string, buildHarness: BuildHarness): void {
  describe(`gateway-core conformance (${gatewayName})`, () => {
    async function withHarness<T>(run: (harness: ConformanceHarness, keys: TestSigningKeys) => Promise<T>): Promise<T> {
      const keys = createTestSigningKeys();
      const harness = await buildHarness(keys);
      try {
        return await run(harness, keys);
      } finally {
        harness.cleanup?.();
      }
    }

    it("commits the audit record before the backend is touched", async () => {
      await withHarness(async (harness) => {
        const client = await connectClient(harness.server);
        try {
          harness.auditCountWhenBackendTouched.value = -1;
          const result = await client.callTool({ name: harness.autonomousTool.name, arguments: harness.autonomousTool.arguments });

          expect(result.isError).toBeFalsy();
          expect(harness.auditCountWhenBackendTouched.value).toBeGreaterThanOrEqual(1);
        } finally {
          await client.close();
        }
      });
    });

    it("denies and audits an unknown tool name", async () => {
      await withHarness(async (harness) => {
        const client = await connectClient(harness.server);
        try {
          const before = harness.audit.list().length;
          const result = await client.callTool({ name: harness.unknownTool, arguments: {} });

          expect(textOf(result)).toMatchObject({ status: "denied" });
          const records = harness.audit.list();
          expect(records.length).toBeGreaterThan(before);
          expect(records.at(-1)).toMatchObject({ tool: harness.unknownTool, decision: "denied" });
        } finally {
          await client.close();
        }
      });
    });

    it("denies and audits malformed input rather than throwing", async () => {
      await withHarness(async (harness) => {
        const client = await connectClient(harness.server);
        try {
          const before = harness.audit.list().length;
          const result = await client.callTool({ name: harness.malformedTool.name, arguments: harness.malformedTool.arguments });

          expect(result.isError).toBeFalsy();
          expect(textOf(result)).toMatchObject({ status: "denied" });
          const records = harness.audit.list();
          expect(records.length).toBeGreaterThan(before);
          expect(records.at(-1)).toMatchObject({ decision: "denied" });
        } finally {
          await client.close();
        }
      });
    });

    it("refuses a request with no bearer token, with 401, audited", async () => {
      await withHarness(async (harness) => {
        const before = harness.listenerAudit.list().length;
        const res = fakeRes();

        await harness.listener(fakeReq({}), res);

        expect(res.statusCode).toBe(401);
        const records = harness.listenerAudit.list();
        expect(records.length).toBeGreaterThan(before);
        expect(records.at(-1)).toMatchObject({ decision: "denied" });
      });
    });

    it("refuses a token issued for a different audience", async () => {
      await withHarness(async (harness, keys) => {
        const before = harness.listenerAudit.list().length;
        const jwt = keys.sign(validClaims(harness, { aud: "api://some-other-gateway-entirely" }));
        const res = fakeRes();

        await harness.listener(fakeReq({ authorization: `Bearer ${jwt}`, "x-actor": "alice@contoso.com", "x-request-id": "req-1" }), res);

        expect(res.statusCode).toBe(401);
        const records = harness.listenerAudit.list();
        expect(records.length).toBeGreaterThan(before);
        expect(records.at(-1)).toMatchObject({ decision: "denied", rules: ["deny.audience_mismatch"] });
      });
    });
  });
}
