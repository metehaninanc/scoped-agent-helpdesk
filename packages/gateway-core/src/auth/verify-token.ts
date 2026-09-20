/**
 * Verify a bearer token presented to a gateway. SPRINT2.md, Stage B, Component 4: signature
 * against the tenant's published keys, `aud` equal to this gateway's own Application ID URI,
 * the expected app role present. Never throws: a token that fails any check is a validation
 * result, not an exception — the same contract decide() makes for tool requests, and for the
 * same reason: a thrown error here must not skip the audit record for the refusal.
 *
 * Deliberately hand-rolled claims plumbing around node:crypto's own primitives (createPublicKey
 * with a JWK, crypto.verify for the RS256 signature) rather than a JWT library: the actual
 * cryptographic verification is node:crypto's, already vetted, not reimplemented here. What is
 * hand-rolled is the same kind of short, readable flow certificate-credential.ts already is for
 * the mirror operation (signing a client assertion instead of verifying an access token).
 */
import { verify as verifySignature } from "node:crypto";

import { JwksClient } from "./jwks.js";

export interface ValidatedToken {
  /** The calling agent's application (client) id — azp for a v2.0 token, appid as a fallback. */
  clientId: string;
  roles: string[];
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type TokenValidationReason =
  | "missing_token"
  | "malformed_token"
  | "unknown_signing_key"
  | "invalid_signature"
  | "expired"
  | "not_yet_valid"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "missing_role";

export type TokenValidationResult = { ok: true; token: ValidatedToken } | { ok: false; reason: TokenValidationReason };

export interface TokenValidatorOptions {
  tenantId: string;
  /** This gateway's own Application ID URI. A token for any other audience is refused. */
  audience: string;
  /** The app role this gateway requires present in the `roles` claim, e.g. "Gateway.Invoke". */
  requiredRole: string;
  /** Injectable for tests; defaults to a real JwksClient for this tenant. */
  jwks?: JwksClient;
  now?: () => Date;
}

interface TokenClaims {
  aud?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  roles?: unknown;
  azp?: string;
  appid?: string;
}

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

function decodeSegment<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
}

export class TokenValidator {
  private readonly tenantId: string;
  private readonly audience: string;
  private readonly requiredRole: string;
  private readonly jwks: JwksClient;
  private readonly now: () => Date;

  constructor(options: TokenValidatorOptions) {
    this.tenantId = options.tenantId;
    this.audience = options.audience;
    this.requiredRole = options.requiredRole;
    this.jwks = options.jwks ?? new JwksClient({ tenantId: options.tenantId });
    this.now = options.now ?? (() => new Date());
  }

  /** `authorizationHeader` is the raw HTTP header value, e.g. "Bearer eyJ...". Never throws. */
  async validate(authorizationHeader: string | undefined): Promise<TokenValidationResult> {
    try {
      return await this.evaluate(authorizationHeader);
    } catch {
      // A JWKS fetch failure, a malformed key, or anything else unexpected: refuse, do not throw.
      return { ok: false, reason: "unknown_signing_key" };
    }
  }

  private async evaluate(authorizationHeader: string | undefined): Promise<TokenValidationResult> {
    if (authorizationHeader === undefined) return { ok: false, reason: "missing_token" };
    const match = BEARER_PATTERN.exec(authorizationHeader.trim());
    if (match === null) return { ok: false, reason: "missing_token" };
    const jwt = match[1]!;

    const parts = jwt.split(".");
    if (parts.length !== 3) return { ok: false, reason: "malformed_token" };
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    let header: { alg?: string; kid?: string };
    let claims: TokenClaims;
    try {
      header = decodeSegment(headerB64);
      claims = decodeSegment(payloadB64);
    } catch {
      return { ok: false, reason: "malformed_token" };
    }

    if (header.alg !== "RS256" || header.kid === undefined) return { ok: false, reason: "malformed_token" };

    const key = await this.jwks.getKey(header.kid);
    if (key === null) return { ok: false, reason: "unknown_signing_key" };

    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(signatureB64, "base64url");
    if (!verifySignature("RSA-SHA256", signingInput, key, signature)) {
      return { ok: false, reason: "invalid_signature" };
    }

    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) return { ok: false, reason: "expired" };
    if (typeof claims.nbf === "number" && claims.nbf > nowSeconds) return { ok: false, reason: "not_yet_valid" };

    // Entra issues a v1.0 token (iss = sts.windows.net) for a custom API resource unless that
    // resource app's manifest sets accessTokenAcceptedVersion: 2, in which case it issues v2.0
    // (iss = login.microsoftonline.com/.../v2.0) instead — confirmed live against the dev
    // tenant's default app registration config, not merely a documented possibility. Both name
    // the same tenant and are equally verifiable; accepting either is a token-format detail,
    // not a security relaxation, so long as the tenant id in the issuer is this one.
    const acceptedIssuers = [
      `https://login.microsoftonline.com/${this.tenantId}/v2.0`,
      `https://sts.windows.net/${this.tenantId}/`,
    ];
    if (typeof claims.iss !== "string" || !acceptedIssuers.includes(claims.iss)) {
      return { ok: false, reason: "issuer_mismatch" };
    }

    if (claims.aud !== this.audience) return { ok: false, reason: "audience_mismatch" };

    const roles = Array.isArray(claims.roles) ? claims.roles.map(String) : [];
    if (!roles.includes(this.requiredRole)) return { ok: false, reason: "missing_role" };

    const clientId = claims.azp ?? claims.appid;
    if (typeof clientId !== "string") return { ok: false, reason: "malformed_token" };

    return { ok: true, token: { clientId, roles, expiresAt: claims.exp * 1000 } };
  }
}
