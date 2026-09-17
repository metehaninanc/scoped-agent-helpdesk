import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { JwksClient } from "./jwks.js";

function makeJwk(kid: string) {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };
  return { kid, kty: jwk.kty, n: jwk.n, e: jwk.e };
}

describe("JwksClient", () => {
  it("fetches the tenant's discovery endpoint and returns a usable key for a known kid", async () => {
    const jwk = makeJwk("key-1");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }),
    );
    const client = new JwksClient({ tenantId: "tenant-1", fetch });

    const key = await client.getKey("key-1");

    expect(key).not.toBeNull();
    expect(key?.asymmetricKeyType).toBe("rsa");
    expect(fetch).toHaveBeenCalledWith(
      "https://login.microsoftonline.com/tenant-1/discovery/v2.0/keys",
      expect.objectContaining({}),
    );
  });

  it("returns null for a kid that does not exist, even after a refetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ keys: [makeJwk("key-1")] }), { status: 200 }),
    );
    const client = new JwksClient({ tenantId: "tenant-1", fetch });

    expect(await client.getKey("key-missing")).toBeNull();
  });

  it("caches a hit and does not refetch for the same kid", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ keys: [makeJwk("key-1")] }), { status: 200 }),
    );
    const client = new JwksClient({ tenantId: "tenant-1", fetch });

    await client.getKey("key-1");
    await client.getKey("key-1");

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refetches on a cache miss, picking up a rotated key without restarting", async () => {
    const first = makeJwk("key-1");
    const second = makeJwk("key-2");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [first] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [first, second] }), { status: 200 }));
    const client = new JwksClient({ tenantId: "tenant-1", fetch });

    expect(await client.getKey("key-1")).not.toBeNull();
    expect(await client.getKey("key-2")).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes once for concurrent callers rather than issuing one fetch per caller", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ keys: [makeJwk("key-1")] }), { status: 200 }),
    );
    const client = new JwksClient({ tenantId: "tenant-1", fetch });

    await Promise.all([client.getKey("key-1"), client.getKey("key-1"), client.getKey("key-1")]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refetches once the cache is older than maxAgeMs, even for a kid it already has", async () => {
    let now = 0;
    const jwk = makeJwk("key-1");
    // A fresh Response per call: a Response's body can only be read once, and mockResolvedValue
    // would otherwise hand out the same already-consumed instance on the second fetch.
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));
    const client = new JwksClient({ tenantId: "tenant-1", fetch, maxAgeMs: 1000, now: () => new Date(now) });

    await client.getKey("key-1");
    now = 2000;
    await client.getKey("key-1");

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("propagates a fetch failure rather than caching an empty key set", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("", { status: 500 }));
    const client = new JwksClient({ tenantId: "tenant-1", fetch });

    await expect(client.getKey("key-1")).rejects.toThrow(/JWKS fetch failed/);
  });

  it("skips a malformed key entry instead of failing the whole refresh", async () => {
    const good = makeJwk("key-good");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ kid: "key-bad", kty: "RSA" }, good] }), { status: 200 }),
    );
    const client = new JwksClient({ tenantId: "tenant-1", fetch });

    expect(await client.getKey("key-bad")).toBeNull();
    expect(await client.getKey("key-good")).not.toBeNull();
  });
});
