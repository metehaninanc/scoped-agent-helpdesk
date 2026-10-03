import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { corpusRawDir, listProductDirs, loadCorpus, readManifest } from "./corpus.js";

const SAMPLE_MANIFEST = {
  product: "entra",
  repo: "MicrosoftDocs/entra-docs",
  commit: "a37c43ae5c2494cfc4211bb6242eb3151de6e40e",
  files: { "sample.md": "docs/sample.md" },
  license: "CC-BY-4.0",
};

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
    await writeFile(join(dir, "entra", "manifest.json"), JSON.stringify(SAMPLE_MANIFEST));
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

  it("indexes nothing, without throwing, when no product directory is present at all", async () => {
    await rm(join(dir, "entra"), { recursive: true, force: true });
    expect(() => loadCorpus(dir)).not.toThrow();
    expect(loadCorpus(dir)).toEqual([]);
  });

  it("fails loudly on a product directory that is present but has no manifest.json — a malformed folder, not an absent one", async () => {
    await rm(join(dir, "entra", "manifest.json"));
    expect(() => loadCorpus(dir)).toThrow(/manifest\.json/);
  });

  it("fails loudly on a manifest.json that does not match the expected shape", async () => {
    await writeFile(join(dir, "entra", "manifest.json"), JSON.stringify({ product: "entra" }));
    expect(() => loadCorpus(dir)).toThrow(/does not match the expected manifest shape/);
  });

  it("discovers a second product directory generically, by no name more specific than 'a directory with a manifest'", async () => {
    await mkdir(join(dir, "widgetworks"), { recursive: true });
    await writeFile(
      join(dir, "widgetworks", "manifest.json"),
      JSON.stringify({ product: "widgetworks", repo: "example/widgetworks-docs", commit: "b".repeat(40), files: { "other.md": "docs/other.md" }, license: "CC-BY-4.0" }),
    );
    await writeFile(join(dir, "widgetworks", "other.md"), "# Widgetworks\n\nSome widgetworks content.\n");

    const chunks = loadCorpus(dir);

    expect(listProductDirs(dir).sort()).toEqual(["entra", "widgetworks"]);
    const widgetChunk = chunks.find((c) => c.id.startsWith("widgetworks/"));
    expect(widgetChunk?.sourceUrl).toBe("https://github.com/example/widgetworks-docs/blob/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/docs/other.md");
  });

  it("builds a distinct, correct source URL per file even when a directory's files do not share a common real path (Sprint 4 prep)", async () => {
    // The bug a single repoPathPrefix could not represent: two files vendored into the same
    // product directory that live under genuinely different paths in the source repo.
    await writeFile(join(dir, "entra", "manifest.json"), JSON.stringify({
      ...SAMPLE_MANIFEST,
      files: { "sample.md": "docs/one/sample.md", "second.md": "docs/two/second.md" },
    }));
    await writeFile(join(dir, "entra", "second.md"), "# Second\n\nAnother file, a different real subfolder.\n");

    const chunks = loadCorpus(dir);

    expect(chunks.find((c) => c.id.startsWith("entra/sample.md"))?.sourceUrl).toBe(
      "https://github.com/MicrosoftDocs/entra-docs/blob/a37c43ae5c2494cfc4211bb6242eb3151de6e40e/docs/one/sample.md",
    );
    expect(chunks.find((c) => c.id.startsWith("entra/second.md"))?.sourceUrl).toBe(
      "https://github.com/MicrosoftDocs/entra-docs/blob/a37c43ae5c2494cfc4211bb6242eb3151de6e40e/docs/two/second.md",
    );
  });

  it("fails loudly on a .md file present on disk with no entry in manifest.json's files map", async () => {
    await writeFile(join(dir, "entra", "undeclared.md"), "# Undeclared\n\nShould not be silently skipped.\n");
    expect(() => loadCorpus(dir)).toThrow(/no "files" entry: undeclared\.md/);
  });

  it("fails loudly on a files map entry naming a file that does not exist on disk", async () => {
    await writeFile(join(dir, "entra", "manifest.json"), JSON.stringify({
      ...SAMPLE_MANIFEST,
      files: { "sample.md": "docs/sample.md", "ghost.md": "docs/ghost.md" },
    }));
    expect(() => loadCorpus(dir)).toThrow(/no matching file on disk: ghost\.md/);
  });
});

describe("readManifest()", () => {
  it("returns the parsed manifest for a well-formed file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helpdesk-corpus-manifest-"));
    try {
      await writeFile(join(dir, "manifest.json"), JSON.stringify(SAMPLE_MANIFEST));
      expect(readManifest(dir)).toEqual(SAMPLE_MANIFEST);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws naming the file when manifest.json is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helpdesk-corpus-manifest-"));
    try {
      expect(() => readManifest(dir)).toThrow(/manifest\.json/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
