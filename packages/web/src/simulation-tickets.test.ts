import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadTickets, ticketKey } from "./simulation-tickets.js";

describe("loadTickets()", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-sim-tickets-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeJson(name: string, content: unknown): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, JSON.stringify(content), "utf8");
    return path;
  }

  it("loads exactly {id, submittedBy, text} per ticket, dropping actualNeed entirely", async () => {
    const path = await writeJson("a.json", [
      { id: "T001", submittedBy: "jane@fake.example", text: "how do I reset my vpn", actualNeed: "VPN client reinstall guidance" },
    ]);

    const loaded = loadTickets([path]);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.ticket).toEqual({ id: "T001", submittedBy: "jane@fake.example", text: "how do I reset my vpn" });
    expect(Object.keys(loaded[0]!.ticket).sort()).toEqual(["id", "submittedBy", "text"]);
    expect("actualNeed" in loaded[0]!.ticket).toBe(false);
    expect(JSON.stringify(loaded[0]!.ticket)).not.toContain("VPN client reinstall guidance");
  });

  it("tracks sourceFile per ticket, since ids repeat across files", async () => {
    const a = await writeJson("a.json", [{ id: "T001", submittedBy: "x@fake.example", text: "hello", actualNeed: "n/a" }]);
    const b = await writeJson("b.json", [{ id: "T001", submittedBy: "y@fake.example", text: "world", actualNeed: "n/a" }]);

    const loaded = loadTickets([a, b]);

    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.sourceFile).toBe(a);
    expect(loaded[1]!.sourceFile).toBe(b);
    expect(ticketKey(loaded[0]!)).not.toBe(ticketKey(loaded[1]!));
  });

  it("fails loudly when actualNeed is missing, rather than silently accepting the entry", async () => {
    const path = await writeJson("a.json", [{ id: "T001", submittedBy: "x@fake.example", text: "hello" }]);

    expect(() => loadTickets([path])).toThrow(/actualNeed/i);
  });

  it("fails loudly on an unexpected extra field", async () => {
    const path = await writeJson("a.json", [
      { id: "T001", submittedBy: "x@fake.example", text: "hello", actualNeed: "n/a", extra: "surprise" },
    ]);

    expect(() => loadTickets([path])).toThrow();
  });

  it("fails loudly when a required field is the wrong type", async () => {
    const path = await writeJson("a.json", [{ id: "T001", submittedBy: 42, text: "hello", actualNeed: "n/a" }]);

    expect(() => loadTickets([path])).toThrow();
  });

  it("fails loudly when the file is not a JSON array", async () => {
    const path = await writeJson("a.json", { not: "an array" });

    expect(() => loadTickets([path])).toThrow(/expected a JSON array/);
  });
});
