/**
 * Prove `reset_password` is refused by the endpoint gateway's own policy engine, by name, on a
 * live MCP round trip — without going through a model at all (SPRINT3.md, 3.4).
 *
 * The endpoint agent's own system prompt (endpoint-agent.ts) tells the model the outcome of this
 * call in advance and says not to retry it, which a well-behaved model correctly reads as "don't
 * spend a tool call finding out what you already know" — confirmed live: three different phrasings
 * of "reset my password," through the real web app, all produced the right answer (decline, point
 * to SSPR then the manager) without the model ever calling the tool. That is good conversational
 * behavior, and it means the policy engine's own `deny.password_reset_never_automated` decision,
 * while fully real and independently covered by `packages/endpoint-gateway/src/tools/server.test.ts`,
 * is not what an ordinary conversation through the web app will exercise. This script is the
 * live-tenant equivalent of that same test: a real bearer token, a real HTTP round trip to the
 * real running gateway, and the actual denial the gateway returns — the mechanism, demonstrated
 * directly rather than waiting for a model to decide to trigger it.
 *
 * Deliberately standalone rather than importing endpoint-agent.ts's own credential loading, same
 * reasoning as token-smoke.ts: this is a diagnostic script, not a fourth agent.
 *
 *   pnpm reset-password-smoke
 *
 * Needs the endpoint gateway already running and reachable (ENDPOINT_GATEWAY_URL, default
 * http://127.0.0.1:3004). Never prints a token, only the gateway's own JSON response.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import { CertificateCredential } from "@helpdesk/identity-gateway";

import { ensureEnvLoaded } from "../env.js";

const envSchema = z.object({
  AZURE_TENANT_ID: z.guid(),
  AZURE_ENDPOINT_AGENT_CLIENT_ID: z.guid(),
  AZURE_ENDPOINT_AGENT_CERT_PATH: z.string().min(1),
  AZURE_ENDPOINT_AGENT_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i),
  ENDPOINT_GATEWAY_AUDIENCE: z.string().min(1),
});

async function main(): Promise<void> {
  ensureEnvLoaded();
  const env = envSchema.parse(process.env);

  const credential = new CertificateCredential({
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_ENDPOINT_AGENT_CLIENT_ID,
    thumbprint: env.AZURE_ENDPOINT_AGENT_CERT_THUMBPRINT,
    privateKeyPem: readFileSync(env.AZURE_ENDPOINT_AGENT_CERT_PATH),
  });
  const { token } = await credential.getToken(`${env.ENDPOINT_GATEWAY_AUDIENCE}/.default`);

  const baseUrl = process.env.ENDPOINT_GATEWAY_URL ?? "http://127.0.0.1:3004";
  const requestId = `reset-password-smoke-${randomUUID()}`;
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token}`,
        "x-actor": "reset-password-smoke@local",
        "x-request-id": requestId,
      },
    },
  });

  const client = new Client({ name: "reset-password-smoke", version: "0.0.0" });
  // The SDK's own StreamableHTTPClientTransportOptions leaves `sessionId` optional in a way
  // `exactOptionalPropertyTypes` treats as incompatible with its own Transport interface; a type
  // mismatch inside the SDK's own declarations, not a real runtime concern.
  await client.connect(transport as Parameters<typeof client.connect>[0]);

  console.log(`requestId: ${requestId}`);
  try {
    const result = await client.callTool({
      name: "reset_password",
      arguments: { userPrincipalName: "alice@contoso.com" },
    });
    const [first] = result.content as { type: string; text: string }[];
    const body = JSON.parse(first?.text ?? "{}") as { status?: string; rules?: string[]; message?: string };
    console.log(JSON.stringify(body, null, 2));

    if (body.status === "denied" && body.rules?.includes("deny.password_reset_never_automated")) {
      console.log("\nPASS: denied by policy, named deny.password_reset_never_automated.");
    } else {
      console.log("\nFAIL: expected a denial naming deny.password_reset_never_automated.");
      process.exit(1);
    }
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  console.error("(Confirm the endpoint gateway is running: pnpm endpoint-gateway.)");
  process.exit(1);
});
