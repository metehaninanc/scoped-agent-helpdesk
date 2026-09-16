import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VAR = "HELPDESK_TEST_ENV_VAR";

/**
 * ensureEnvLoaded() loads at most once per process (module-level state), which is the whole
 * point of it, but means each test needs a genuinely fresh module to observe "not yet loaded"
 * behaviour rather than silently inheriting the previous test's load.
 */
async function freshEnsureEnvLoaded(): Promise<typeof import("./env.js").ensureEnvLoaded> {
  vi.resetModules();
  const mod = await import("./env.js");
  return mod.ensureEnvLoaded;
}

describe("ensureEnvLoaded()", () => {
  let dir: string;
  let deepDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-agent-env-"));
    deepDir = join(dir, "a", "b", "c");
    await mkdir(deepDir, { recursive: true });
    delete process.env[VAR];
  });

  afterEach(async () => {
    delete process.env[VAR];
    await rm(dir, { recursive: true, force: true });
  });

  it("finds .env by walking up from a nested directory and loads it", async () => {
    await writeFile(join(dir, ".env"), `${VAR}=from-dotenv\n`, "utf8");
    const ensureEnvLoaded = await freshEnsureEnvLoaded();

    ensureEnvLoaded(deepDir);

    expect(process.env[VAR]).toBe("from-dotenv");
  });

  it("does not overwrite a variable already set in the real environment", async () => {
    await writeFile(join(dir, ".env"), `${VAR}=from-dotenv\n`, "utf8");
    process.env[VAR] = "from-shell";
    const ensureEnvLoaded = await freshEnsureEnvLoaded();

    ensureEnvLoaded(deepDir);

    expect(process.env[VAR]).toBe("from-shell");
  });

  it("does nothing, and does not throw, when no .env is found up the tree", async () => {
    // deepDir's parent chain (a real OS temp directory) has no .env above it.
    const ensureEnvLoaded = await freshEnsureEnvLoaded();

    expect(() => ensureEnvLoaded(deepDir)).not.toThrow();
    expect(process.env[VAR]).toBeUndefined();
  });

  it("loads only once: a second call does not re-read a since-changed file", async () => {
    await writeFile(join(dir, ".env"), `${VAR}=first\n`, "utf8");
    const ensureEnvLoaded = await freshEnsureEnvLoaded();

    ensureEnvLoaded(deepDir);
    expect(process.env[VAR]).toBe("first");

    await writeFile(join(dir, ".env"), `${VAR}=second\n`, "utf8");
    ensureEnvLoaded(deepDir);

    expect(process.env[VAR]).toBe("first");
  });
});
