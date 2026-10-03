/**
 * Resolves every citation URL the knowledge corpus can produce and checks that it actually
 * opens — the re-runnable version of the claim this gateway's whole design rests on: "every
 * answer cites the source document and heading" (SPRINT3.md, 3.3) only means something if a
 * reader who clicks that citation reaches the source, not a 404.
 *
 * This exists because that claim was not true. Widening the corpus (Sprint 4 prep) found that
 * `entra`'s and `intune`'s manifests, shipped since SPRINT3.md 3.3, built citation URLs from a
 * single `repoPathPrefix` string that did not match where several of their files actually live
 * in their source repos — `corpus.ts`'s manifest schema moved from `repoPathPrefix` to a
 * per-file `files` map for exactly this reason (see that file's own header comment), and both
 * existing manifests were corrected against it. This script is what stops that from happening
 * silently again: it does not trust that a manifest's `files` map was typed correctly, the same
 * way `prove-isolation` does not trust that a Graph permission grant was made correctly — it
 * asks the actual source (here, GitHub, not Microsoft Graph) and reports what it says.
 *
 * Every chunk's `sourceUrl` is checked — deduplicated by URL first, since every chunk from the
 * same file shares one citation and there is no reason to fetch the same URL once per chunk.
 *
 *   pnpm knowledge-verify-citations
 *
 * Exits non-zero if any citation does not resolve. Writes evidence/knowledge-corpus-citations.txt.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { corpusRawDir, loadCorpus } from "../corpus.js";

interface CheckResult {
  sourceTitle: string;
  sourceUrl: string;
  status: number | "error";
  pass: boolean;
}

const MAX_ATTEMPTS = 3;

async function fetchStatus(sourceUrl: string): Promise<number | "error"> {
  try {
    const response = await fetch(sourceUrl, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    // The body is not read: a citation only needs to resolve, and GitHub blob pages are large
    // enough that discarding the body for hundreds of citations is worth avoiding here.
    await response.body?.cancel();
    return response.status;
  } catch {
    return "error";
  }
}

/** A 404 is conclusive on the first try — retrying it does not make a wrong path right. A
 * network error or a 5xx is not conclusive; GitHub returned a real, reproducible 503 for one
 * genuinely correct citation during this script's own first run, which a single-attempt check
 * would have reported as a broken citation it is not. Retrying only those cases, a few times
 * with a short pause, is what keeps this script trustworthy enough to actually re-run — a
 * verification command that cries wolf on transient noise gets ignored, which is worse than not
 * having one. */
async function checkUrl(sourceUrl: string): Promise<number | "error"> {
  let last: number | "error" = "error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await fetchStatus(sourceUrl);
    if (last !== "error" && last < 500) return last;
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  return last;
}

function formatReport(results: CheckResult[]): string {
  const col = (s: string, w: number): string => (s.length >= w ? s : s + " ".repeat(w - s.length)) + "  ";
  const failing = results.filter((r) => !r.pass);
  const lines: string[] = [
    "Knowledge corpus citation check — every distinct sourceUrl the corpus can produce, resolved",
    "against GitHub directly, not assumed from the manifest that built it.",
    `Run at: ${new Date().toISOString()}`,
    `Distinct citations checked: ${results.length}`,
    "",
    "A citation is what a reader reaches by clicking the source document and heading this gateway",
    "cites for every fact it states (SPRINT3.md, 3.3). A 404 here means that claim is false for",
    "that citation regardless of whether retrieval itself works, since retrieval never fetches",
    "sourceUrl — it only stores and returns it.",
    "",
    col("status", 8) + col("source title", 58) + "url",
    "-".repeat(140),
  ];

  for (const r of results) {
    lines.push(col(r.pass ? "OK" : String(r.status), 8) + col(r.sourceTitle, 58) + r.sourceUrl);
  }

  lines.push("");
  if (failing.length === 0) {
    lines.push(`All ${results.length} citations resolve.`);
  } else {
    lines.push(`${failing.length} of ${results.length} citation(s) do not resolve:`);
    for (const r of failing) lines.push(`  ${r.status}  ${r.sourceUrl}`);
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const chunks = loadCorpus(corpusRawDir());

  // One check per distinct URL, not per chunk: a heavily-chunked article would otherwise inflate
  // both the request count and the report with the same citation repeated many times over.
  const byUrl = new Map<string, string>();
  for (const chunk of chunks) {
    if (!byUrl.has(chunk.sourceUrl)) byUrl.set(chunk.sourceUrl, chunk.sourceTitle);
  }

  const results: CheckResult[] = [];
  for (const [sourceUrl, sourceTitle] of byUrl) {
    const status = await checkUrl(sourceUrl);
    results.push({ sourceTitle, sourceUrl, status, pass: status === 200 });
  }
  results.sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl));

  const report = formatReport(results);
  process.stdout.write(report);

  const evidencePath = resolve("evidence/knowledge-corpus-citations.txt");
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, report, "utf8");
  console.log(`Written to ${evidencePath}`);

  if (results.some((r) => !r.pass)) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
