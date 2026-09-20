/**
 * Client-credentials flow with a certificate (private_key_jwt), on node:crypto and fetch.
 *
 * Deliberately hand-rolled rather than @azure/identity: this is the only package that holds
 * credentials, the flow is ~60 lines, and every byte of it should be readable. The shape
 * (getToken(scope) -> { token, expiresAt }) matches TokenCredential, so swapping in
 * @azure/identity later is a one-line change.
 *
 * Nothing in this file logs. The assertion and the access token must never reach a log line
 * or an error message.
 */
import { createPrivateKey, createSign, randomUUID, type KeyObject } from "node:crypto";

export interface CertificateCredentialOptions {
  tenantId: string;
  clientId: string;
  /** SHA-1 thumbprint of the certificate, 40 hex characters as the portal shows it. */
  thumbprint: string;
  /** PEM private key, PKCS#8 ("PRIVATE KEY") or PKCS#1 ("RSA PRIVATE KEY"). */
  privateKeyPem: string | Buffer;
  /** Defaults to the public cloud. */
  authorityHost?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  /** Assertion id generator, injectable for tests. */
  jti?: () => string;
}

export interface AccessToken {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export class TokenError extends Error {
  override readonly name = "TokenError";
  constructor(
    readonly status: number,
    /** OAuth error code, e.g. "invalid_client". "unknown" when the response was not JSON. */
    readonly code: string,
    description: string,
  ) {
    super(`Token request failed (${status} ${code}): ${description}`);
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA1_HEX = /^[0-9a-f]{40}$/i;
const ASSERTION_LIFETIME_S = 600;
/** Refresh this long before expiry so a token never dies mid-request. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_AUTHORITY = "https://login.microsoftonline.com";
const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

const base64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

export class CertificateCredential {
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly x5t: string;
  private readonly key: KeyObject;
  private readonly tokenUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => Date;
  private readonly jti: () => string;
  private readonly cache = new Map<string, AccessToken>();

  constructor(options: CertificateCredentialOptions) {
    if (!GUID.test(options.tenantId)) throw new Error("tenantId must be a tenant GUID");
    if (!GUID.test(options.clientId)) throw new Error("clientId must be an application (client) GUID");
    if (!SHA1_HEX.test(options.thumbprint)) {
      throw new Error("thumbprint must be the certificate's SHA-1 thumbprint: 40 hex characters");
    }

    this.tenantId = options.tenantId;
    this.clientId = options.clientId;
    // Entra identifies the signing certificate by x5t: base64url of the DER SHA-1 digest.
    this.x5t = Buffer.from(options.thumbprint, "hex").toString("base64url");
    this.key = createPrivateKey(options.privateKeyPem);
    this.tokenUrl = `${options.authorityHost ?? DEFAULT_AUTHORITY}/${options.tenantId}/oauth2/v2.0/token`;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.jti = options.jti ?? randomUUID;
  }

  /** A fresh, signed client assertion. Short-lived and single-use by construction. */
  createAssertion(): string {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", x5t: this.x5t }));
    const payload = base64url(
      JSON.stringify({
        aud: this.tokenUrl,
        iss: this.clientId,
        sub: this.clientId,
        jti: this.jti(),
        nbf: nowSeconds,
        iat: nowSeconds,
        exp: nowSeconds + ASSERTION_LIFETIME_S,
      }),
    );
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(this.key);
    return `${header}.${payload}.${base64url(signature)}`;
  }

  async getToken(scope: string): Promise<AccessToken> {
    const cached = this.cache.get(scope);
    if (cached && cached.expiresAt - this.now().getTime() > REFRESH_SKEW_MS) return cached;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      scope,
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: this.createAssertion(),
    });

    const response = await this.fetch(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Not JSON: fall through with the status alone. The body may be an HTML error page.
    }

    if (!response.ok || typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
      const code = typeof json.error === "string" ? json.error : "unknown";
      const description =
        typeof json.error_description === "string" ? json.error_description : `unexpected response (${text.length} bytes)`;
      throw new TokenError(response.status, code, description);
    }

    const token: AccessToken = {
      token: json.access_token,
      expiresAt: this.now().getTime() + json.expires_in * 1000,
    };
    this.cache.set(scope, token);
    return token;
  }
}
