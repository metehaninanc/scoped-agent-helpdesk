/**
 * The generic mechanics of loading a gateway's environment: find the nearest `.env` above the
 * working directory, load it, then validate against a schema the gateway itself supplies.
 *
 * SPRINT3.md, 3.2: before this phase, one schema (`gatewayEnvSchema`, in the identity gateway)
 * hardcoded every field both the identity and MDM gateways needed — `AZURE_IDENTITY_*` next to
 * `AZURE_MDM_*`, one `IDENTITY_GATEWAY_AUDIENCE` next to one `MDM_GATEWAY_AUDIENCE`. That does
 * not survive a third or fourth gateway: a credential-less gateway (SPRINT3.md, 3.3) would still
 * have been forced through a schema demanding a certificate it does not have. The mechanics of
 * "find, load, validate" are generic and belong here; the schema — which variables a specific
 * gateway actually needs — is what SPRINT3.md means by "its own", and stays with each gateway.
 *
 * Loading order: real environment variables win, then `.env` fills the gaps. That is
 * process.loadEnvFile()'s own rule, and it is what lets a one-off override such as
 * `AZURE_IDENTITY_CERT_PATH=... node ...` work without editing the file.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

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

/** `.env` lines like `X=` arrive as empty strings; treat those as unset. Exported so every
 * gateway's own schema treats an emptied-out override the same way. */
export const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

export interface LoadEnvOptions {
  /** Explicit `.env` path. Default: the nearest `.env` above the working directory, if any. */
  envFile?: string;
  /** Source of variables, for tests. Default: process.env after loading the file. */
  env?: NodeJS.ProcessEnv;
}

/** Load `.env` (unless `options.env` is given, for tests) and parse it against `schema`. Throws,
 * naming every offending field, if the environment does not match — the gateway fails loudly at
 * startup rather than running with a config it silently misread. */
export function loadEnv<T>(schema: z.ZodType<T>, options: LoadEnvOptions = {}): T {
  if (options.env === undefined) {
    const file = options.envFile ?? findEnvFile();
    if (file !== undefined) process.loadEnvFile(file);
  }
  const parsed = schema.safeParse(options.env ?? process.env);
  if (!parsed.success) {
    throw new Error(`Gateway environment is incomplete or malformed:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
