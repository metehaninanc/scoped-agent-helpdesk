import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { JwksClient } from "./jwks.js";
import { TokenValidator } from "./verify-token.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const AUDIENCE = "api://helpdesk-identity-gateway";
const ROLE = "Gateway.Invoke";
const AGENT_CLIENT_ID = "22222222-2222-4222-8222-222222222222";

const base64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

function signJwt(privateKey: KeyObject, header: Record<string, unknown>, claims: Record<string, unknown>): string {
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

describe("TokenValidator", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };
  const KID = "test-key";
  const nowSeconds = Math.floor(Date.UTC(2026, 8, 17, 12, 0, 0) / 1000);

  function fakeJwks(): JwksClient {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ keys: [{ kid: KID, ...jwk }] }), { status: 200 }));
    return new JwksClient({ tenantId: TENANT, fetch });
  }

  const validator = (): TokenValidator =>
    new TokenValidator({ tenantId: TENANT, audience: AUDIENCE, requiredRole: ROLE, jwks: fakeJwks(), now: () => new Date(nowSeconds * 1000) });

  const validClaims = (): Record<string, unknown> => ({
    aud: AUDIENCE,
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    exp: nowSeconds + 3600,
    nbf: nowSeconds - 60,
    roles: [ROLE],
    azp: AGENT_CLIENT_ID,
  });

  const token = (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: KID }): string =>
    signJwt(privateKey, header, claims);

  it("accepts a well-formed token: right signature, audience, role, issuer, not expired", async () => {
    const result = await validator().validate(`Bearer ${token(validClaims())}`);
    expect(result).toEqual({
      ok: true,
      token: { clientId: AGENT_CLIENT_ID, roles: [ROLE], expiresAt: (nowSeconds + 3600) * 1000 },
    });
  });

  it("falls back to appid when azp is absent", async () => {
    const claims = validClaims();
    delete claims.azp;
    claims.appid = "33333333-3333-4333-8333-333333333333";
    const result = await validator().validate(`Bearer ${token(claims)}`);
    expect(result).toMatchObject({ ok: true, token: { clientId: "33333333-3333-4333-8333-333333333333" } });
  });

  it("rejects a missing Authorization header", async () => {
    expect(await validator().validate(undefined)).toEqual({ ok: false, reason: "missing_token" });
  });

  it("rejects a header that is not a Bearer token", async () => {
    expect(await validator().validate("Basic dXNlcjpwYXNz")).toEqual({ ok: false, reason: "missing_token" });
  });

  it("rejects a token that is not three dot-separated segments", async () => {
    expect(await validator().validate("Bearer not-a-jwt")).toEqual({ ok: false, reason: "malformed_token" });
  });

  it("rejects a signature that no longer matches a tampered payload", async () => {
    const jwt = token(validClaims());
    const [h, , s] = jwt.split(".");
    const tamperedPayload = base64url(JSON.stringify({ ...validClaims(), roles: ["Global.Admin"] }));
    expect(await validator().validate(`Bearer ${h}.${tamperedPayload}.${s}`)).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("rejects a token signed by a key this tenant does not publish", async () => {
    const impostor = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const jwt = signJwt(impostor, { alg: "RS256", kid: KID }, validClaims());
    expect(await validator().validate(`Bearer ${jwt}`)).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects an unknown kid", async () => {
    const jwt = token(validClaims(), { alg: "RS256", kid: "no-such-key" });
    expect(await validator().validate(`Bearer ${jwt}`)).toEqual({ ok: false, reason: "unknown_signing_key" });
  });

  it("rejects a non-RS256 header", async () => {
    const jwt = token(validClaims(), { alg: "none", kid: KID });
    expect(await validator().validate(`Bearer ${jwt}`)).toEqual({ ok: false, reason: "malformed_token" });
  });

  it("rejects an expired token", async () => {
    const jwt = token({ ...validClaims(), exp: nowSeconds - 1 });
    expect(await validator().validate(`Bearer ${jwt}`)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token not yet valid", async () => {
    const jwt = token({ ...validClaims(), nbf: nowSeconds + 3600 });
    expect(await validator().validate(`Bearer ${jwt}`)).toEqual({ ok: false, reason: "not_yet_valid" });
  });

  it("rejects the wrong issuer", async () => {
    const jwt = token({ ...validClaims(), iss: "https://login.microsoftonline.com/some-other-tenant/v2.0" });
    expect(await validator().validate(`Bearer ${jwt}`)).toEqual({ ok: false, reason: "issuer_mismatch" });
  });

  it("accepts a v1.0 token issuer for this tenant, not only v2.0", async () => {
    // Entra issues v1.0 tokens (sts.windows.net) for a custom API resource by default, unless
    // that resource's app manifest sets accessTokenAcceptedVersion: 2 — confirmed live against
    // the dev tenant, not assumed. Both name this tenant and are equally verifiable.
    const jwt = token({ ...validClaims(), iss: `https://sts.windows.net/${TENANT}/` });
    const result = await validator().validate(`Bearer ${jwt}`);
    expect(result.ok).toBe(true);
  });

  it("rejects a v1.0-shaped issuer naming a different tenant", async () => {
    const jwt = token({ ...validClaims(), iss: "https://sts.windows.net/some-other-tenant/" });
    expect(await validator().validate(`Bearer ${jwt}`)).toEqual({ ok: false, reason: "issuer_mismatch" });
  });

  it("rejects the wrong audience — the cross-gateway refusal SPRINT2.md's Component 4 demonstrates", async () => {
    const jwt = token({ ...validClaims(), aud: "api://helpdesk-mdm-gateway" });
    expect(await validator().validate(`Bearer ${jwt}`)).toEqual({ ok: false, reason: "audience_mismatch" });
  });

  it("rejects a token missing the required role", async () => {
    const jwt = token({ ...validClaims(), roles: ["SomeOtherRole"] });
    expect(await validator().validate(`Bearer ${jwt}`)).toEqual({ ok: false, reason: "missing_role" });
  });

  it("rejects a token with no roles claim at all", async () => {
    const claims = validClaims();
    delete claims.roles;
    expect(await validator().validate(`Bearer ${token(claims)}`)).toEqual({ ok: false, reason: "missing_role" });
  });

  it("never throws, even when the JWKS fetch itself fails", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("", { status: 500 }));
    const broken = new TokenValidator({
      tenantId: TENANT,
      audience: AUDIENCE,
      requiredRole: ROLE,
      jwks: new JwksClient({ tenantId: TENANT, fetch }),
    });
    await expect(broken.validate(`Bearer ${token(validClaims())}`)).resolves.toEqual({
      ok: false,
      reason: "unknown_signing_key",
    });
  });
});
