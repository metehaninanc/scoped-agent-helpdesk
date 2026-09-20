/**
 * Entra's public signing keys for a tenant, fetched over HTTPS and cached in memory. These are
 * public keys: nothing here can mint a token, only check one. Shared by both gateways
 * (SPRINT2.md, Stage B, Component 4) — same fetch-and-cache mechanics, each instance pointed at
 * the shared tenant.
 */
import { createPublicKey, type KeyObject } from "node:crypto";

export interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}

export interface JwksClientOptions {
  tenantId: string;
  fetch?: typeof globalThis.fetch;
  /** A cache hit older than this is refreshed anyway, so a rotated key is picked up eventually. */
  maxAgeMs?: number;
  now?: () => Date;
}

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

/** Fetches and caches a tenant's RSA signing keys, keyed by `kid`. */
export class JwksClient {
  private readonly tenantId: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly maxAgeMs: number;
  private readonly now: () => Date;
  private cache: { keys: Map<string, KeyObject>; fetchedAt: number } | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(options: JwksClientOptions) {
    this.tenantId = options.tenantId;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * The signing key for `kid`, or null if no known key matches even after a refresh. Refetches
   * on a cache miss (a `kid` this gateway has never seen, most likely a rotated key) or once the
   * cache is older than `maxAgeMs`, so a key Entra has revoked eventually stops being trusted.
   */
  async getKey(kid: string): Promise<KeyObject | null> {
    const stale = this.cache === null || this.now().getTime() - this.cache.fetchedAt > this.maxAgeMs;
    if (stale || !this.cache?.keys.has(kid)) {
      await this.refresh();
    }
    return this.cache?.keys.get(kid) ?? null;
  }

  /** Concurrent callers share one in-flight fetch rather than each issuing their own. */
  private async refresh(): Promise<void> {
    this.refreshing ??= this.fetchAndCache().finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
  }

  private async fetchAndCache(): Promise<void> {
    const url = `https://login.microsoftonline.com/${this.tenantId}/discovery/v2.0/keys`;
    const response = await this.fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status} ${response.statusText}`);

    const body = (await response.json()) as { keys?: Jwk[] };
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kid === undefined || jwk.kty !== "RSA" || jwk.n === undefined || jwk.e === undefined) continue;
      try {
        keys.set(jwk.kid, createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" }));
      } catch {
        // A key this runtime cannot construct is skipped, not fatal to the whole refresh.
      }
    }
    this.cache = { keys, fetchedAt: this.now().getTime() };
  }
}
