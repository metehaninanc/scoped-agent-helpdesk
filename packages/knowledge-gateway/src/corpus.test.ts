import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { corpusRawDir, loadCorpus } from "./corpus.js";

const SAMPLE_DOC = `---
title: Sample Concept Article
description: A fixture, not a real Microsoft Learn article.
ms.topic: concept-article
ms.date: 01/01/2026
---

# Sample concept article

This is the introduction paragraph, before any other heading.

## First section

Content of the first section, with a [link](https://example.com) and **bold** text.

### First subsection

Nested content that should still get its own chunk under its own heading.

## Second section

> [!NOTE]
> A callout that should have its marker stripped but its text kept.

Second section body text.
`;

describe("loadCorpus()", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "helpdesk-corpus-"));
    await mkdir(join(dir, "entra"), { recursive: true });
    await writeFile(join(dir, "entra", "sample.md"), SAMPLE_DOC);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("chunks by heading, tagging each chunk with the document's title and its own heading", () => {
    const chunks = loadCorpus(dir);

    expect(chunks.map((c) => c.heading)).toEqual([
      "Sample concept article",
      "First section",
      "First subsection",
      "Second section",
    ]);
    expect(chunks.every((c) => c.sourceTitle === "Sample Concept Article")).toBe(true);
  });

  it("puts the introductory paragraph under the document's own title as its first chunk", () => {
    const [first] = loadCorpus(dir);
    expect(first?.text).toContain("introduction paragraph");
  });

  it("strips link syntax to plain text but keeps the link's own words", () => {
    const chunks = loadCorpus(dir);
    const firstSection = chunks.find((c) => c.heading === "First section");
    expect(firstSection?.text).toContain("link");
    expect(firstSection?.text).not.toContain("](https://example.com)");
  });

  it("strips a callout marker but keeps the callout's own text", () => {
    const chunks = loadCorpus(dir);
    const secondSection = chunks.find((c) => c.heading === "Second section");
    expect(secondSection?.text).toContain("A callout that should have its marker stripped");
    expect(secondSection?.text).not.toContain("[!NOTE]");
  });

  it("builds a stable source URL naming the repo, the pinned commit, and the file path", () => {
    const [first] = loadCorpus(dir);
    expect(first?.sourceUrl).toBe(
      "https://github.com/MicrosoftDocs/entra-docs/blob/a37c43ae5c2494cfc4211bb6242eb3151de6e40e/docs/sample.md",
    );
  });

  it("skips a source directory that does not exist rather than throwing", async () => {
    await rm(join(dir, "entra"), { recursive: true, force: true });
    expect(() => loadCorpus(dir)).not.toThrow();
    expect(loadCorpus(dir)).toEqual([]);
  });
});

describe("loadCorpus() against the real vendored corpus", () => {
  it("parses every real file without throwing and produces a non-trivial number of chunks", () => {
    const chunks = loadCorpus(corpusRawDir());
    expect(chunks.length).toBeGreaterThan(20);
  });

  it("contains real, known content from the pinned Entra and Intune docs", () => {
    const chunks = loadCorpus(corpusRawDir());
    const text = chunks.map((c) => c.text).join("\n");
    expect(text).toContain("Security groups");
    expect(text).toContain("Global Administrator");
  });

  it("cites a real document title and heading for a known fact", () => {
    const chunks = loadCorpus(corpusRawDir());
    const pillars = chunks.find((c) => /three pillars/i.test(c.text) && c.sourceTitle === "Microsoft Intune core concepts");
    expect(pillars).toBeDefined();
  });
});
