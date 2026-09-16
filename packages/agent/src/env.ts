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
