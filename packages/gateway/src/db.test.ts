import { describe, expect, it } from "vitest";

import { MIN_NODE_VERSION, assertNodeSupportsSqlite } from "./db.js";

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
