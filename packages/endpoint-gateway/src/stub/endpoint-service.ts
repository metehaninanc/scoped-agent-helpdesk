/**
 * A stand-in for whatever endpoint management tool a real deployment would run — an RMM
 * platform, a printer fleet manager, a ticketing system's asset inventory, or something else
 * entirely. SPRINT3.md, 3.4 is explicit that pretending to integrate with one specific product
 * would be a worse demonstration than admitting the seam: every organisation runs different
 * tooling here, so this is openly a stub, marked as one in its own name, not dressed up as a
 * real integration.
 *
 * What replacing this with a real integration would involve, and nothing else, because
 * @helpdesk/gateway-core already carries the rest (SPRINT3.md, 3.4's own framing, "the answer to
 * 'how would you apply this to our environment'"):
 *
 *   1. This file's three methods, reimplemented against the real product's API.
 *   2. A credential for that API, held only by this gateway process, the same shape as
 *      CertificateCredential/GraphClient in packages/identity-gateway — never forwarded to an
 *      agent, never minted from an incoming bearer token (see the README, "Stage B: gateways do
 *      not forward tokens").
 *   3. This package's own env.ts would gain that credential's fields, the same way
 *      packages/mdm-gateway's did in SPRINT2.md, Stage A.
 *   4. Nothing else. tools/handler.ts, policy/decide.ts, the audit wiring, the HTTP transport and
 *      token validation all stay exactly as they are — they never knew this was a stub.
 *
 * In-memory only: state resets every process restart, same as any other fake used in this
 * project's tests, except this one also backs the live gateway process, not just its test suite.
 */
import { randomUUID } from "node:crypto";

export type EndpointStatus = "online" | "offline" | "rebooting";

export interface EndpointSummary {
  id: string;
  hostname: string;
  status: EndpointStatus;
  lastCheckInAt: string;
}

export interface EndpointService {
  listEndpoints(): Promise<EndpointSummary[]>;
  getEndpoint(id: string): Promise<EndpointSummary | null>;
  /** The one gated write. Sets status to "rebooting" and stamps a fresh check-in time; there is
   * no background process to flip it back to "online" — this is a stub, not a device. */
  rebootEndpoint(id: string): Promise<EndpointSummary>;
}

export interface EndpointServiceOptions {
  now?: () => Date;
  /** Injectable for tests; a fresh, small fleet by default. */
  seed?: readonly EndpointSummary[];
}

const defaultSeed = (now: () => Date): EndpointSummary[] => [
  { id: "ep-front-desk-01", hostname: "front-desk-01", status: "online", lastCheckInAt: now().toISOString() },
  { id: "ep-warehouse-printer-02", hostname: "warehouse-printer-02", status: "online", lastCheckInAt: now().toISOString() },
  { id: "ep-conf-room-b-03", hostname: "conf-room-b-03", status: "offline", lastCheckInAt: now().toISOString() },
];

/** Not used by the gateway itself; kept for tests and for symmetry with the other packages'
 * id-shaped schema helpers (e.g. identity-gateway's deviceId). */
export const endpointIdPattern = /^ep-[a-z0-9-]+$/;

export function createEndpointService(options: EndpointServiceOptions = {}): EndpointService {
  const now = options.now ?? (() => new Date());
  const endpoints = new Map((options.seed ?? defaultSeed(now)).map((e) => [e.id, { ...e }]));

  return {
    async listEndpoints() {
      return [...endpoints.values()];
    },
    async getEndpoint(id) {
      return endpoints.get(id) ?? null;
    },
    async rebootEndpoint(id) {
      const existing = endpoints.get(id);
      if (!existing) throw new Error(`endpoint ${id} not found`);
      const updated: EndpointSummary = { ...existing, status: "rebooting", lastCheckInAt: now().toISOString() };
      endpoints.set(id, updated);
      return updated;
    },
  };
}

/** Only used if a test needs an id guaranteed not to collide with the seeded fleet. */
export const randomEndpointId = (): string => `ep-${randomUUID().slice(0, 8)}`;
