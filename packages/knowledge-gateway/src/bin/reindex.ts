/**
 * Rebuilds the documentation corpus from whatever product directories are present under
 * corpus/raw/ and reports what it found — the command a maintainer runs after dropping a new
 * product's Markdown into its own subdirectory, per the folder contract corpus.ts enforces (a
 * manifest.json per directory, discovered rather than hardcoded — see that file's own header
 * comment). There is no persisted index file to write: the corpus is small enough that every
 * gateway process already rebuilds it from these same files at its own startup, so this command's
 * job is to do that same rebuild on demand and print a summary, so a maintainer finds out
 * immediately whether a new directory is well-formed, without needing to start the gateway to
 * find out.
 *
 * Reindexing is a command for now, not a button in the admin panel: a refresh control in the UI
 * would be a write action, and would need to go through the policy engine and the audit log like
 * every other write in this project does — a later piece of work, not this one.
 *
 *   pnpm knowledge-reindex
 *
 * Exit code 0 on success, 1 if any product directory present is malformed (missing or invalid
 * manifest.json) — the same "fail loudly" contract loadCorpus() itself has, surfaced here before
 * a gateway process would have hit it at startup.
 */
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { corpusRawDir, listProductDirs, loadCorpus, readManifest } from "../corpus.js";

function main(): void {
  const root = corpusRawDir();
  console.log(`corpus root: ${root}`);

  const productDirs = listProductDirs(root);
  if (productDirs.length === 0) {
    console.log("no product directories found — the corpus is empty");
    return;
  }

  console.log("");
  console.log("product        files  repo@commit                                                    license");
  console.log("-------        -----  -----------                                                    -------");

  let totalFiles = 0;
  for (const dirName of productDirs) {
    const productDir = join(root, dirName);
    // Throws loudly on a missing or malformed manifest.json — exactly loadCorpus()'s own
    // contract, checked per directory here so one bad directory's error names itself instead of
    // being buried in whichever chunk count looks short.
    const manifest = readManifest(productDir);
    const fileCount = readdirSync(productDir).filter((f) => extname(f) === ".md").length;
    totalFiles += fileCount;
    const repoAtCommit = `${manifest.repo}@${manifest.commit.slice(0, 7)}`;
    console.log(`${dirName.padEnd(14)} ${String(fileCount).padStart(5)}  ${repoAtCommit.padEnd(62)} ${manifest.license}`);
  }

  const chunks = loadCorpus(root);
  console.log("");
  console.log(`${productDirs.length} product director${productDirs.length === 1 ? "y" : "ies"}, ${totalFiles} file(s), ${chunks.length} chunk(s) total`);
}

try {
  main();
} catch (error: unknown) {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
