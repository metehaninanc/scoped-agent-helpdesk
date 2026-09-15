/**
 * Gateway environment. This is the only place in the repo that reads the certificate path.
 * SPRINT1.md: "Never let the agent package read the certificate path from the environment.
 * If that import becomes convenient, the architecture has drifted."
 *
 * Loading order: real environment variables win, then `.env` fills the gaps. That is
 * process.loadEnvFile()'s own rule, and it is what lets a one-off override such as
 * `AZURE_CERT_PATH=... node ...` work without editing the file.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const guid = z.guid();

export const gatewayEnvSchema = z.object({
  AZURE_TENANT_ID: guid,
  AZURE_CLIENT_ID: guid,
  /** Path to the PEM private key. Lives outside the repo. */
  AZURE_CERT_PATH: z.string().min(1),
  /** SHA-1 thumbprint, 40 hex characters, as the portal shows it. */
  AZURE_CERT_THUMBPRINT: z.string().regex(/^[0-9a-f]{40}$/i, "must be a 40-character hex SHA-1 thumbprint"),
});

export type GatewayEnv = z.infer<typeof gatewayEnvSchema>;

/** Walk up from `start` looking for a `.env`. Returns undefined if none is found. */
export function findEnvFile(start: string = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface LoadEnvOptions {
  /** Explicit `.env` path. Default: the nearest `.env` above the working directory, if any. */
  envFile?: string;
  /** Source of variables, for tests. Default: process.env after loading the file. */
  env?: NodeJS.ProcessEnv;
}

export function loadGatewayEnv(options: LoadEnvOptions = {}): GatewayEnv {
  if (options.env === undefined) {
    const file = options.envFile ?? findEnvFile();
    if (file !== undefined) process.loadEnvFile(file);
  }
  const parsed = gatewayEnvSchema.safeParse(options.env ?? process.env);
  if (!parsed.success) {
    throw new Error(`Gateway environment is incomplete or malformed:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
