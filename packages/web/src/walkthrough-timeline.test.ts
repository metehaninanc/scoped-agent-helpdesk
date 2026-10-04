import { describe, expect, it } from "vitest";

import { Timeline, mmss } from "./walkthrough-timeline.js";

describe("Timeline", () => {
  it("totals the video's own seconds, not the run's", () => {
    const t = new Timeline();
    t.add("a.png", 2, "one");
    t.add("b.png", 0.5, "one");
    t.add("c.png", 4, "two");
    expect(t.totalSeconds()).toBe(6.5);
    expect(t.length).toBe(3);
  });

  it("groups consecutive frames into scenes with the video time each starts at", () => {
    const t = new Timeline();
    t.add("a.png", 2, "title");
    t.add("b.png", 3, "request");
    t.add("c.png", 1, "request");
    t.add("d.png", 5, "console");
    expect(t.scenes()).toEqual([
      { scene: "title", startSeconds: 0, seconds: 2 },
      { scene: "request", startSeconds: 2, seconds: 4 },
      { scene: "console", startSeconds: 6, seconds: 5 },
    ]);
  });

  it("writes an ffmpeg concat script that repeats the last frame so its duration is honoured", () => {
    const t = new Timeline();
    t.add("C:\\tmp\\a.png", 1.5, "s");
    t.add("C:\\tmp\\b.png", 2, "s");
    expect(t.concatList()).toBe(["file 'C:/tmp/a.png'", "duration 1.500", "file 'C:/tmp/b.png'", "duration 2.000", "file 'C:/tmp/b.png'", ""].join("\n"));
  });

  it("escapes a quote in a file name", () => {
    const t = new Timeline();
    t.add("it's.png", 1, "s");
    expect(t.concatList()).toContain("file 'it'\\''s.png'");
  });

  it("refuses a frame held for no time, and an empty encode", () => {
    const t = new Timeline();
    expect(() => t.add("a.png", 0, "s")).toThrow();
    expect(() => t.concatList()).toThrow();
  });
});

describe("mmss()", () => {
  it("formats minutes and seconds", () => {
    expect(mmss(0)).toBe("0:00");
    expect(mmss(247)).toBe("4:07");
    expect(mmss(59.6)).toBe("1:00");
  });
});
