/**
 * Decode a JWT's claims without verifying the signature. Display only — which roles a token
 * carries, for a human reading a smoke test or the isolation evidence — never used to authorize
 * anything. Nothing that calls this may print the token itself or the signed assertion that
 * requested it (see certificate-credential.ts).
 */
export function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}
