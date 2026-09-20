/**
 * Test-only signing keys: a real RSA keypair and a `JwksClient` that serves its public half over
 * a faked fetch, so a test can hand a `TokenValidator` something it will actually verify, and
 * sign tokens that validator will actually accept or refuse. Used by verify-token.test.ts and by
 * conformance.ts's "missing token" / "wrong audience" checks, and exported so a gateway building
 * its own conformance harness (conformance.ts) can sign tokens with the same keys its validator
 * trusts.
 */
import { createSign, generateKeyPairSync } from "node:crypto";

import { JwksClient } from "./auth/jwks.js";

export interface TestSigningKeys {
  /** Serves this test's own public key over a faked fetch. Point a real TokenValidator at it. */
  jwks: JwksClient;
  /** The `kid` this key is published under. */
  kid: string;
  /** Signs `claims` as an RS256 JWT with this test's private key. Returns the raw token, no "Bearer " prefix. */
  sign: (claims: Record<string, unknown>, header?: Record<string, unknown>) => string;
}

const base64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

export function createTestSigningKeys(kid = "test-key"): TestSigningKeys {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };

  const fetch = async (): Promise<Response> => new Response(JSON.stringify({ keys: [{ kid, ...jwk }] }), { status: 200 });
  const jwks = new JwksClient({ tenantId: "test-tenant", fetch });

  const sign = (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid }): string => {
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(claims));
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
    return `${signingInput}.${base64url(signature)}`;
  };

  return { jwks, kid, sign };
}
