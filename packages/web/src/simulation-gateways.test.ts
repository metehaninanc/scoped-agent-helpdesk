import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { unreachableGateways } from "./simulation-gateways.js";

function listen(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((s) => s.destroy());
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

describe("unreachableGateways()", () => {
  const open: Server[] = [];
  afterEach(() => {
    for (const s of open.splice(0)) s.close();
  });

  it("reports nothing when every gateway is accepting connections", async () => {
    const a = await listen();
    const b = await listen();
    open.push(a.server, b.server);
    expect(await unreachableGateways([`http://127.0.0.1:${a.port}/mcp`, `http://127.0.0.1:${b.port}`])).toEqual([]);
  });

  it("names the gateway that is not listening, and only that one", async () => {
    const up = await listen();
    const dead = await listen();
    const deadPort = dead.port;
    await new Promise<void>((r) => dead.server.close(() => r()));
    open.push(up.server);

    expect(await unreachableGateways([`http://127.0.0.1:${up.port}/mcp`, `http://127.0.0.1:${deadPort}/mcp`])).toEqual([`127.0.0.1:${deadPort}`]);
  });
});
