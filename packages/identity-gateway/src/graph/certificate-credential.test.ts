import { createVerify, generateKeyPairSync } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { CertificateCredential, TokenError, type CertificateCredentialOptions } from "./certificate-credential.js";

// ---------------------------------------------------------------------------
// Fixtures. A throwaway RSA key pair; the thumbprint is the one from a real dev cert but it
// only has to be well-formed here, since Entra is the only party that checks it.
// ---------------------------------------------------------------------------

const TENANT = "f5590adf-b4c2-43c0-a656-5fb76451a2b7";
const CLIENT = "c5b0ccee-0c0f-41ac-8c96-ea33904f0601";
const THUMBPRINT = "05F23EDD313751366FA4ED021EE300C9E8C68AD4";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

let privateKeyPem: string;
let publicKeyPem: string;

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }) as string;
});

const decodeSegment = (segment: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;

/** A clock that starts at a fixed instant and can be moved. */
function clock(startMs = Date.UTC(2026, 8, 15, 12, 0, 0)) {
  let t = startMs;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

function tokenResponse(token = "tok", expiresIn = 3599): Response {
  return new Response(JSON.stringify({ token_type: "Bearer", expires_in: expiresIn, access_token: token }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function credential(overrides: Partial<CertificateCredentialOptions> = {}) {
  // A Response body can be read once, so build a fresh one per call.
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => tokenResponse());
  const time = clock();
  const cred = new CertificateCredential({
    tenantId: TENANT,
    clientId: CLIENT,
    thumbprint: THUMBPRINT,
    privateKeyPem,
    fetch,
    now: time.now,
    ...overrides,
  });
  return { cred, fetch, time };
}

// ---------------------------------------------------------------------------

describe("CertificateCredential", () => {
  describe("construction", () => {
    it.each(["", "05F23EDD", "not-a-thumbprint-but-forty-characters!!!", THUMBPRINT + "00"])(
      "rejects thumbprint %j",
      (thumbprint) => {
        expect(() => credential({ thumbprint })).toThrow(/thumbprint/i);
      },
    );

    it("rejects a private key that is not a key", () => {
      expect(() => credential({ privateKeyPem: "-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----" })).toThrow();
    });

    it.each(["", "contoso", "f5590adf"])("rejects tenant id %j", (tenantId) => {
      expect(() => credential({ tenantId })).toThrow(/tenant/i);
    });
  });

  describe("createAssertion()", () => {
    it("produces a JWT whose header names RS256 and the certificate thumbprint as x5t", () => {
      const { cred } = credential();
      const [header] = cred.createAssertion().split(".");

      expect(decodeSegment(header!)).toEqual({
        alg: "RS256",
        typ: "JWT",
        x5t: Buffer.from(THUMBPRINT, "hex").toString("base64url"),
      });
    });

    it("accepts a lowercase thumbprint and encodes the same x5t", () => {
      const { cred } = credential({ thumbprint: THUMBPRINT.toLowerCase() });
      const [header] = cred.createAssertion().split(".");
      expect(decodeSegment(header!).x5t).toBe(Buffer.from(THUMBPRINT, "hex").toString("base64url"));
    });

    it("claims the token endpoint as audience and the client as issuer and subject", () => {
      const { cred, time } = credential({ jti: () => "fixed-jti" });
      const [, payload] = cred.createAssertion().split(".");
      const nowSeconds = Math.floor(time.now().getTime() / 1000);

      expect(decodeSegment(payload!)).toEqual({
        aud: TOKEN_URL,
        iss: CLIENT,
        sub: CLIENT,
        jti: "fixed-jti",
        nbf: nowSeconds,
        iat: nowSeconds,
        exp: nowSeconds + 600,
      });
    });

    it("signs with the private key so the public key verifies it", () => {
      const { cred } = credential();
      const [header, payload, signature] = cred.createAssertion().split(".");

      const verifier = createVerify("RSA-SHA256");
      verifier.update(`${header}.${payload}`);
      expect(verifier.verify(publicKeyPem, Buffer.from(signature!, "base64url"))).toBe(true);
    });

    it("uses a fresh jti for every assertion", () => {
      const { cred } = credential();
      const jti = (jwt: string) => decodeSegment(jwt.split(".")[1]!).jti;
      expect(jti(cred.createAssertion())).not.toBe(jti(cred.createAssertion()));
    });

    it("honours a non-default authority host", () => {
      const { cred } = credential({ authorityHost: "https://login.microsoftonline.us" });
      const [, payload] = cred.createAssertion().split(".");
      expect(decodeSegment(payload!).aud).toBe(`https://login.microsoftonline.us/${TENANT}/oauth2/v2.0/token`);
    });
  });

  describe("getToken()", () => {
    it("posts a client_credentials request with the assertion to the tenant token endpoint", async () => {
      const { cred, fetch } = credential();

      const token = await cred.getToken(GRAPH_SCOPE);

      expect(token.token).toBe("tok");
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe(TOKEN_URL);
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("grant_type")).toBe("client_credentials");
      expect(body.get("client_id")).toBe(CLIENT);
      expect(body.get("scope")).toBe(GRAPH_SCOPE);
      expect(body.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
      expect(body.get("client_assertion")?.split(".")).toHaveLength(3);
    });

    it("reports expiry from expires_in relative to the injected clock", async () => {
      const { cred, time } = credential();
      const token = await cred.getToken(GRAPH_SCOPE);
      expect(token.expiresAt).toBe(time.now().getTime() + 3599 * 1000);
    });

    it("caches the token per scope until it nears expiry", async () => {
      const { cred, fetch, time } = credential();

      await cred.getToken(GRAPH_SCOPE);
      await cred.getToken(GRAPH_SCOPE);
      expect(fetch).toHaveBeenCalledTimes(1);

      await cred.getToken("https://vault.azure.net/.default");
      expect(fetch).toHaveBeenCalledTimes(2);

      // 3599s lifetime, 5 minute refresh skew: still cached at 50 minutes, refreshed at 55.
      time.advance(50 * 60 * 1000);
      await cred.getToken(GRAPH_SCOPE);
      expect(fetch).toHaveBeenCalledTimes(2);

      time.advance(5 * 60 * 1000);
      await cred.getToken(GRAPH_SCOPE);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("throws a TokenError carrying the AADSTS code and description, never the assertion", async () => {
      const { cred, fetch } = credential();
      fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "invalid_client",
            error_description: "AADSTS700027: The certificate with identifier used to sign the client assertion is not registered on application.",
            error_codes: [700027],
            correlation_id: "abc",
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
      );

      const failure = await cred.getToken(GRAPH_SCOPE).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(TokenError);
      const err = failure as TokenError;
      expect(err.status).toBe(401);
      expect(err.code).toBe("invalid_client");
      expect(err.message).toContain("AADSTS700027");
      expect(err.message).not.toContain("eyJ");
    });

    it("throws a TokenError on a non-JSON failure", async () => {
      const { cred, fetch } = credential();
      fetch.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));

      await expect(cred.getToken(GRAPH_SCOPE)).rejects.toBeInstanceOf(TokenError);
    });

    it("does not cache a failed request", async () => {
      const { cred, fetch } = credential();
      fetch.mockResolvedValueOnce(new Response("{}", { status: 500 }));

      await expect(cred.getToken(GRAPH_SCOPE)).rejects.toThrow();
      await expect(cred.getToken(GRAPH_SCOPE)).resolves.toMatchObject({ token: "tok" });
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
