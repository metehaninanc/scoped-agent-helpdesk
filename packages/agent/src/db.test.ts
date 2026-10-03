import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "./db.js";

describe("openDatabase()", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-agent-db-"));
    dbPath = join(dir, "nested", "chain.db");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a path that does not exist, by default", () => {
    expect(() => openDatabase(dbPath)).toThrow(/No audit database at/);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("creates the path and its parent directory when { create: true } is passed", () => {
    const db = openDatabase(dbPath, { create: true });
    db.close();
    expect(existsSync(dbPath)).toBe(true);
  });

  it("opens an already-existing path with no create flag needed", () => {
    openDatabase(dbPath, { create: true }).close();
    const db = openDatabase(dbPath);
    db.close();
  });

  it("never applies the existence check to :memory:", () => {
    const db = openDatabase(":memory:");
    db.close();
  });
});
