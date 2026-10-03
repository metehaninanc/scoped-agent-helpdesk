import { describe, expect, it } from "vitest";

import { escapeHtml, formatDuration } from "./html.js";

describe("escapeHtml()", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<script>&"'</script>`)).toBe("&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;");
  });

  it("renders null and undefined as an empty string, not the literal word", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("formatDuration()", () => {
  it("shows minutes for anything under an hour", () => {
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("shows hours and minutes together once past an hour", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
  });

  it("drops minutes once past a day unless there are some left over", () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe("1d");
    expect(formatDuration((24 * 60 + 5) * 60_000)).toBe("1d 5m");
  });

  it("shows days, hours and minutes together for a genuinely old item", () => {
    expect(formatDuration((2 * 24 * 60 + 3 * 60 + 15) * 60_000)).toBe("2d 3h 15m");
  });
});
