/**
 * The Entra user principal name shape, shared by every gateway that ever names a user: the
 * identity gateway's own tools (SPRINT1.md), and the approval workflow's own approver-identity
 * check (SPRINT3.md, 3.4, once that workflow moved here from being identity-gateway-only). A UPN
 * is a UPN regardless of which gateway is asking, so this lives in the neutral package rather
 * than being defined once per gateway that happens to need it — the same reasoning `GraphClient`
 * and `CertificateCredential` already follow for Graph plumbing (SPRINT2.md: "shared code, not
 * shared configuration").
 */
import { z } from "zod";

/**
 * Entra UPN: local part @ dotted domain. Guest UPNs look like
 * `bob_gmail.com#EXT#@contoso.onmicrosoft.com`, so `#` must be allowed in the local part.
 * Whitespace and path separators are rejected outright: the UPN ends up in a Graph URL path.
 */
const UPN_PATTERN = /^[^\s@\\/]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export const userPrincipalName = z
  .string()
  .max(113, "UPN exceeds the Entra maximum of 113 characters")
  .regex(UPN_PATTERN, "must be a user principal name such as alice@contoso.com");
