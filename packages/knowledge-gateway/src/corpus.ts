/**
 * Loads and chunks the vendored documentation corpus (SPRINT3.md, 3.3). No network access at
 * read time: the files under corpus/raw/ are the pinned-commit copies themselves, checked into
 * this package (see the root README, "Knowledge gateway notes", for the exact commits, the
 * repositories, and their licenses). This gateway has no backend client at all — loading the
 * corpus from disk once at startup, not fetching it, is what makes that true.
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

interface CorpusSource {
  /** Directory name under corpus/raw/, and the GitHub repo it was vendored from. */
  dir: string;
  repo: string;
  /** The commit these files were fetched at — see README for why this one, and its license. */
  commit: string;
  /** The path prefix inside that repo corresponding to corpus/raw/<dir>/. */
  repoPathPrefix: string;
}

/** SPRINT3.md, 3.3: "record the commit and the license." The license itself is recorded once, in
 * the README, next to these same two commits — not repeated per file here. */
const SOURCES: readonly CorpusSource[] = [
  { dir: "entra", repo: "MicrosoftDocs/entra-docs", commit: "a37c43ae5c2494cfc4211bb6242eb3151de6e40e", repoPathPrefix: "docs" },
  { dir: "intune", repo: "MicrosoftDocs/memdocs", commit: "4b5429df8b47046c6b251e572ee61199fb5d4a5d", repoPathPrefix: "intune" },
];

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

function chunkDocument(source: CorpusSource, fileName: string, raw: string): CorpusChunk[] {
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(raw);
  const frontmatter = frontmatterMatch?.[1] ?? "";
  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;
  const sourceTitle = extractTitle(frontmatter, fileName);
  const repoPath = `${source.repoPathPrefix}/${relativeDocPath(source.dir, fileName)}`;
  const sourceUrl = `https://github.com/${source.repo}/blob/${source.commit}/${repoPath}`;

  const lines = body.split(/\r?\n/);
  const chunks: CorpusChunk[] = [];
  let heading = sourceTitle;
  let buffer: string[] = [];
  let index = 0;

  const flush = (): void => {
    const text = cleanMarkdown(buffer.join("\n"));
    if (text.length > 0) {
      chunks.push({ id: `${source.dir}/${fileName}#${index++}`, sourceTitle, heading, text, sourceUrl });
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

/** corpus/raw/<dir>/<fileName> only ever holds files one level deep today; kept as a function
 * rather than a template string so a future subdirectory has one place to change. */
function relativeDocPath(_dir: string, fileName: string): string {
  return fileName;
}

let cached: CorpusChunk[] | null = null;

/** The directory this package's own corpus/raw/ lives under, resolved relative to this module's
 * own location so it is found regardless of the caller's working directory — this is vendored
 * package content, not a runtime data directory like data/*.db. */
export function corpusRawDir(): string {
  return fileURLToPath(new URL("../corpus/raw", import.meta.url));
}

/** Loads and chunks the corpus once per process; the corpus is small and static, so there is
 * nothing to invalidate. Injectable `dir` for tests only. */
export function loadCorpus(dir: string = corpusRawDir()): CorpusChunk[] {
  if (cached && dir === corpusRawDir()) return cached;

  const chunks: CorpusChunk[] = [];
  for (const source of SOURCES) {
    const sourceDir = join(dir, source.dir);
    let fileNames: string[];
    try {
      fileNames = readdirSync(sourceDir).filter((f) => extname(f) === ".md");
    } catch {
      continue;
    }
    for (const fileName of fileNames.sort()) {
      const raw = readFileSync(join(sourceDir, fileName), "utf8");
      chunks.push(...chunkDocument(source, fileName, raw));
    }
  }

  if (dir === corpusRawDir()) cached = chunks;
  return chunks;
}
