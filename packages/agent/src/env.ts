/**
 * Load .env once, before the Agent SDK spawns its own Claude Code subprocess, so a live run
 * does not depend on the shell having ANTHROPIC_API_KEY exported.
 *
 * process.loadEnvFile() only fills gaps: a variable already set in the real environment wins
 * over whatever .env says. That is Node's own behaviour, and it is what lets a one-off
 * override (`ANTHROPIC_API_KEY=... node identity-agent.js ...`) work without editing the file.
 * See gateway/src/env.ts for the same rule, documented there for the same reason: the agent
 * package may not import that file (SPRINT1.md), so this is a second small copy of the
 * walk-up-for-.env logic, not of anything identity-, policy- or credential-shaped.
 *
 * options.env in the SDK's query() replaces the subprocess environment entirely if set at
 * all; leaving it unset (as identity-agent.ts does) means the subprocess inherits
 * process.env, so loading here is also how the key reaches that subprocess — no extra
 * plumbing needed once process.env itself carries it.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

let loaded = false;

export function ensureEnvLoaded(startDir: string = process.cwd()): void {
  if (loaded) return;
  loaded = true;

  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** Selects how the four agents' Agent SDK subprocess authenticates. Unset (the default) leaves
 * options.env unset, so the subprocess inherits process.env and uses ANTHROPIC_API_KEY — the way
 * every pass through section 6 ran, and the only way a headless server can run. "session" strips
 * the key from the subprocess's environment only, so it falls back to the machine's logged-in
 * Claude session instead; triage and the rationale generator call the Messages API in-process
 * and still read the key from process.env, untouched. */
export const AGENT_AUTH_ENV = "HELPDESK_AGENT_AUTH";

/** The phrase runStoppingReason() (sdk-usage-errors.ts) matches to stop a batch run. */
export const AGENT_AUTH_PATH_MISMATCH = "Agent auth path mismatch";

/** The `env` to hand the Agent SDK's query(), or undefined to leave it unset (inherit
 * process.env). The SDK replaces the subprocess environment entirely when this is set at all, so
 * session mode passes a full copy minus the one variable, never a partial object. */
export function agentSubprocessEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> | undefined {
  if (source[AGENT_AUTH_ENV] !== "session") return undefined;
  const { ANTHROPIC_API_KEY: _withheld, ...rest } = source;
  return rest;
}

/** Called with the `apiKeySource` the SDK reports in its own init message, on every agent call.
 * Withholding the key from options.env is a request, not a guarantee — a different source of the
 * same key (an apiKeyHelper, a project setting) would silently put the run back on the API key,
 * which is precisely how a batch run drains a balance nobody meant to spend. In session mode the
 * only acceptable report is "none": no API key, so the call is on the login session. */
export function assertAgentAuthPath(apiKeySource: string, source: NodeJS.ProcessEnv = process.env): void {
  if (source[AGENT_AUTH_ENV] !== "session" || apiKeySource === "none") return;
  throw new Error(
    `${AGENT_AUTH_PATH_MISMATCH}: ${AGENT_AUTH_ENV}=session requires the agent subprocess to report apiKeySource "none" (the login session), but it reported "${apiKeySource}" — it is using an API key.`,
  );
}
