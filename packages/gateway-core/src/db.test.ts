import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IN_MEMORY, MIN_NODE_VERSION, assertNodeSupportsSqlite, openDatabase } from "./db.js";

describe("assertNodeSupportsSqlite()", () => {
  it.each(["22.13.0", "22.13.1", "22.20.0", "23.0.0", "24.1.0"])("accepts Node %s", (v) => {
    expect(() => assertNodeSupportsSqlite(v)).not.toThrow();
  });

  it.each(["18.20.4", "20.19.0", "22.5.0", "22.12.0"])("rejects Node %s with a message naming the minimum", (v) => {
    expect(() => assertNodeSupportsSqlite(v)).toThrow(MIN_NODE_VERSION);
  });

  it("passes on the Node running these tests", () => {
    expect(() => assertNodeSupportsSqlite()).not.toThrow();
  });
});

describe("openDatabase()", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-db-"));
    dbPath = join(dir, "nested", "chain.db");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a path that does not exist, by default", () => {
    expect(() => openDatabase(dbPath)).toThrow(/No audit database at/);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("never creates the file as a side effect of the refusal", () => {
    try {
      openDatabase(dbPath);
    } catch {
      // expected
    }
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
    const db = openDatabase(IN_MEMORY);
    db.close();
  });
});
