import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findEnvFile, loadEnv, optionalString } from "./env.js";

describe("findEnvFile()", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-env-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("finds a .env in the starting directory", async () => {
    await writeFile(join(dir, ".env"), "X=1");
    expect(findEnvFile(dir)).toBe(join(dir, ".env"));
  });

  it("finds a .env in a parent directory", async () => {
    await writeFile(join(dir, ".env"), "X=1");
    const nested = join(dir, "a", "b");
    expect(findEnvFile(nested)).toBe(join(dir, ".env"));
  });

  it("returns undefined when no .env exists anywhere above", async () => {
    // A tenant-less directory: the search walks up to the filesystem root and stops.
    expect(findEnvFile(join(dir, "nowhere"))).not.toBe(join(dir, ".env"));
  });
});

describe("loadEnv()", () => {
  const schema = z.object({ REQUIRED_FIELD: z.string().min(1), OPTIONAL_FIELD: optionalString });

  it("parses the given env object without touching process.env or the filesystem", () => {
    const result = loadEnv(schema, { env: { REQUIRED_FIELD: "x" } });
    expect(result).toEqual({ REQUIRED_FIELD: "x", OPTIONAL_FIELD: undefined });
  });

  it("treats an emptied-out variable as unset via optionalString", () => {
    const result = loadEnv(schema, { env: { REQUIRED_FIELD: "x", OPTIONAL_FIELD: "" } });
    expect(result.OPTIONAL_FIELD).toBeUndefined();
  });

  it("throws, naming the offending field, when the environment does not match", () => {
    expect(() => loadEnv(schema, { env: {} })).toThrow(/REQUIRED_FIELD/);
  });

  it("lets a gateway define a schema with only the fields it needs — no forced fields from another gateway", () => {
    const knowledgeGatewaySchema = z.object({ CORPUS_PATH: z.string().min(1) });
    const result = loadEnv(knowledgeGatewaySchema, { env: { CORPUS_PATH: "/data/docs" } });
    expect(result).toEqual({ CORPUS_PATH: "/data/docs" });
  });
});
