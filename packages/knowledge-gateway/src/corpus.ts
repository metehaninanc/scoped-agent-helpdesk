/**
 * Loads and chunks the vendored documentation corpus (SPRINT3.md, 3.3). No network access at
 * read time: the files under corpus/raw/ are the pinned-commit copies themselves, checked into
 * this package (see the root README, "Knowledge gateway notes", for the exact commits, the
 * repositories, and their licenses). This gateway has no backend client at all — loading the
 * corpus from disk once at startup, not fetching it, is what makes that true.
 *
 * Sprint 4 prep: the corpus is a folder contract, not a hardcoded list. Adding a product means
 * dropping its Markdown into its own subdirectory under corpus/raw/ with a manifest.json naming
 * where it came from — nothing in this file names "entra" or "intune" specifically. Every
 * subdirectory corpus/raw/ actually contains must have a valid manifest; one that does not is a
 * malformed product folder, not an absent one, and fails loudly rather than being silently
 * skipped (see loadCorpus() below) — the same "fail loudly on the unexpected" discipline this
 * project already applies to the simulation ticket loader (simulation-tickets.ts).
 *
 * Chunking is by heading, per SPRINT3.md's own instruction: every Markdown heading line (any
 * level, `#` through `######`) starts a new chunk, tagged with that heading's own text. A
 * document's `# Title` line is itself a heading, so the introductory paragraph under it becomes
 * the document's own first chunk, headed by the document's title — no special-casing needed. A
 * chunk runs until the next heading or the end of the file. This is deliberately finer-grained
 * than "one chunk per document": a match inside a specific `###` subsection is cited under that
 * subsection's own heading, not the document's title alone, which is what "every answer cites
 * its source document and heading" (SPRINT3.md) asks for at the most precise level available.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export interface CorpusChunk {
  /** Stable within one process; not persisted anywhere, so it never needs to survive a restart. */
  id: string;
  /** The document's own frontmatter title — the "source document" half of a citation. */
  sourceTitle: string;
  /** The specific heading this chunk falls under — the other half of a citation. */
  heading: string;
  /** Plain-ish text: Markdown link/image/callout syntax stripped, prose kept. */
  text: string;
  /** A stable link back to the exact pinned-commit file this chunk came from. */
  sourceUrl: string;
}

/** One product directory's own manifest.json — the whole folder contract. `product` is
 * informational (it is the directory name too, kept explicit rather than implied so a manifest
 * is self-describing if it is ever read on its own). */
export interface CorpusManifest {
  product: string;
  repo: string;
  commit: string;
  /** The path prefix inside that repo corresponding to corpus/raw/<dir>/. */
  repoPathPrefix: string;
  /** SPRINT3.md, 3.3: "record the commit and the license." Free text — the README's own
   * "Knowledge gateway notes" is the canonical explanation when a license needs more than a
   * one-line identifier (entra-docs' own discrepancy between its LICENSE file and its
   * ThirdPartyNotices.md, for instance). */
  license: string;
}

const ManifestSchema = z
  .object({
    product: z.string().min(1),
    repo: z.string().min(1),
    commit: z
      .string()
      .regex(/^[0-9a-f]{40}$/i, "must be a 40-character git commit SHA"),
    repoPathPrefix: z.string().min(1),
    license: z.string().min(1),
  })
  .strict();

/** Reads and validates one product directory's manifest.json. Throws with the directory name and
 * the exact validation failure — a maintainer dropping in a new product finds out immediately
 * what is missing, not from a gateway that quietly indexed nothing for it. */
export function readManifest(productDir: string): CorpusManifest {
  const path = join(productDir, "manifest.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: could not read or parse as JSON — ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${path}: does not match the expected manifest shape:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function extractTitle(frontmatter: string, fallback: string): string {
  const match = /^title:\s*(.+)\s*$/m.exec(frontmatter);
  if (!match) return fallback;
  return match[1]!.trim().replace(/^["']|["']$/g, "");
}

/** Strips the Markdown syntax that would otherwise show up as noise in indexed or displayed
 * text: links/images, inline formatting, callout markers, and docs-specific `:::` directives.
 * Deliberately shallow — this is lexical search over prose, not a Markdown renderer. */
function cleanMarkdown(text: string): string {
  return text
    .replace(/:::[a-z-]+[\s\S]*?:::/gi, " ")
    .replace(/<a\s+name=['"][^'"]*['"]\s*>\s*<\/a>/gi, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/^>\s*\[![A-Z]+]\s*/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_`]{1,3}/g, "")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `dirName` is a plain string, not `manifest.product` — the directory actually walked, kept
 * separate from the manifest's own self-reported name in case the two are ever allowed to
 * differ. Today loadCorpus() always passes them equal. */
function chunkDocument(manifest: CorpusManifest, dirName: string, fileName: string, raw: string): CorpusChunk[] {
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(raw);
  const frontmatter = frontmatterMatch?.[1] ?? "";
  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;
  const sourceTitle = extractTitle(frontmatter, fileName);
  const repoPath = `${manifest.repoPathPrefix}/${fileName}`;
  const sourceUrl = `https://github.com/${manifest.repo}/blob/${manifest.commit}/${repoPath}`;

  const lines = body.split(/\r?\n/);
  const chunks: CorpusChunk[] = [];
  let heading = sourceTitle;
  let buffer: string[] = [];
  let index = 0;

  const flush = (): void => {
    const text = cleanMarkdown(buffer.join("\n"));
    if (text.length > 0) {
      chunks.push({ id: `${dirName}/${fileName}#${index++}`, sourceTitle, heading, text, sourceUrl });
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = HEADING_PATTERN.exec(line);
    if (match) {
      flush();
      heading = match[2]!.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return chunks;
}

let cached: CorpusChunk[] | null = null;

/** The directory this package's own corpus/raw/ lives under, resolved relative to this module's
 * own location so it is found regardless of the caller's working directory — this is vendored
 * package content, not a runtime data directory like data/*.db. */
export function corpusRawDir(): string {
  return fileURLToPath(new URL("../corpus/raw", import.meta.url));
}

/** Every product subdirectory directly under `dir` — the folder contract's own discovery step,
 * shared by loadCorpus() and bin/reindex.ts so both walk the corpus the same way. Sorted for a
 * deterministic order; a directory with no manifest.json is a malformed product folder and
 * readManifest() will say so, not something this function silently filters out. */
export function listProductDirs(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return entries.sort();
}

/** Loads and chunks the corpus once per process; the corpus is small and static, so there is
 * nothing to invalidate. Injectable `dir` for tests only. Every product directory present under
 * `dir` must have a valid manifest.json — see readManifest() — or this throws; a directory that
 * is not present at all is simply not indexed, which is how dropping a new product in without
 * restarting anything would be discovered on the next process start. */
export function loadCorpus(dir: string = corpusRawDir()): CorpusChunk[] {
  if (cached && dir === corpusRawDir()) return cached;

  const chunks: CorpusChunk[] = [];
  for (const dirName of listProductDirs(dir)) {
    const productDir = join(dir, dirName);
    const manifest = readManifest(productDir);
    const fileNames = readdirSync(productDir)
      .filter((f) => extname(f) === ".md")
      .sort();
    for (const fileName of fileNames) {
      const raw = readFileSync(join(productDir, fileName), "utf8");
      chunks.push(...chunkDocument(manifest, dirName, fileName, raw));
    }
  }

  if (dir === corpusRawDir()) cached = chunks;
  return chunks;
}
