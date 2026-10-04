import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildActorMapping, loadOrBuildActorMapping } from "./simulation-actor-mapping.js";

describe("buildActorMapping()", () => {
  it("assigns real users round robin, in sorted order of the synthetic address", () => {
    const mapping = buildActorMapping(["c@fake.example", "a@fake.example", "b@fake.example"], ["u1", "u2"]);

    expect(mapping).toEqual({ "a@fake.example": "u1", "b@fake.example": "u2", "c@fake.example": "u1" });
  });

  it("deduplicates repeated addresses before assigning", () => {
    const mapping = buildActorMapping(["a@fake.example", "a@fake.example", "b@fake.example"], ["u1", "u2"]);

    expect(Object.keys(mapping)).toHaveLength(2);
  });

  it("is deterministic across calls with the same input", () => {
    const addresses = ["z@fake.example", "a@fake.example", "m@fake.example"];
    expect(buildActorMapping(addresses, ["u1", "u2", "u3"])).toEqual(buildActorMapping(addresses, ["u1", "u2", "u3"]));
  });

  it("throws rather than mapping onto an empty pool of real users", () => {
    expect(() => buildActorMapping(["a@fake.example"], [])).toThrow(/at least one real test user/);
  });
});

describe("loadOrBuildActorMapping()", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-sim-actor-mapping-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("builds and writes a mapping when the file does not exist yet", () => {
    const path = join(dir, "actor-mapping.json");

    const mapping = loadOrBuildActorMapping(path, ["b@fake.example", "a@fake.example"], ["u1", "u2"]);

    expect(mapping).toEqual({ "a@fake.example": "u1", "b@fake.example": "u2" });
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk).toEqual(mapping);
  });

  it("reuses the committed file on a later call rather than rebuilding it", () => {
    const path = join(dir, "actor-mapping.json");
    const first = loadOrBuildActorMapping(path, ["a@fake.example", "b@fake.example"], ["u1", "u2"]);

    // A different pool passed on the second call must have no effect: the committed file wins.
    const second = loadOrBuildActorMapping(path, ["a@fake.example", "b@fake.example"], ["u9"]);

    expect(second).toEqual(first);
  });

  it("refuses to reuse a committed mapping whose addresses no longer match the current tickets", () => {
    const path = join(dir, "actor-mapping.json");
    loadOrBuildActorMapping(path, ["a@fake.example", "b@fake.example"], ["u1", "u2"]);

    expect(() => loadOrBuildActorMapping(path, ["a@fake.example", "c@fake.example"], ["u1", "u2"])).toThrow(
      /does not cover exactly/,
    );
  });
});
