/**
 * Triage-only accuracy harness. Classification alone — no agents, no gateways, no tool calls —
 * run against this project's own 150-ticket set and a hand-built ground-truth label file
 * (test/triage-ground-truth.json). Isolates triage's own category definitions from everything
 * section 6's own pass three otherwise bundles together (the agents' own behavior, handoff
 * resolution, tool execution), so the definitions can be iterated against real data in minutes
 * and for cents rather than guessed at, or inferred secondhand from a full simulation pass.
 *
 *   pnpm triage-harness --label baseline
 *   pnpm triage-harness --label sharpened
 *   pnpm triage-harness --label sonnet --model claude-sonnet-5
 *   pnpm triage-harness --label mixed-r1 --tickets test/mixed-set.json --labels test/mixed-set-labels.json
 *
 * --tickets / --labels pick the ticket file(s) (comma-separated) and the label file they are scored
 * against; the defaults are the original three sim_records files and test/triage-ground-truth.json,
 * so every earlier invocation behaves as before. A label entry may carry `"ambiguous": true` (a
 * judgement call); the report then also splits accuracy into firm and judgement-call labels, and by
 * source where a ticket id carries a source prefix ("d2-T031") or the run spans several files.
 *
 * --label names this run's own output file (evidence/triage-harness-<label>.md) and nothing
 * else — it does not change behavior, only where the report lands, so a baseline and a later
 * run against sharpened definitions sit side by side rather than overwriting each other. An
 * existing label is refused unless --overwrite is passed. A usage limit, an authentication
 * failure or an exhausted credit balance (runStoppingReason(), @helpdesk/agent) stops the run and
 * writes nothing — a standing condition on the account is not a classification result.
 * --model overrides HELPDESK_TRIAGE_MODEL / DEFAULT_TRIAGE_MODEL, for comparing a different
 * model against the identical, unmodified prompt — a separate question from whether the
 * category definitions themselves are the problem, and run only once sharpening the
 * definitions has been tried first (see the root README's own account of why).
 *
 * This file never reads a ticket's actualNeed — loadTickets() (simulation-tickets.ts) strips it
 * before a ticket's own type can carry it this far, the same discipline bin/simulate.ts already
 * holds itself to. The ground-truth label file is a separate, hand-built artifact scored against
 * triage's own category definitions, not against actualNeed directly (actualNeed is a free-text
 * sentence describing the person's real need, not a category — see the root README for the
 * methodology and its own acknowledged limits).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import { createTriageClassifier, ensureEnvLoaded, runStoppingReason, type TriageCategory, type TriageScope } from "@helpdesk/agent";

import { priceUsage } from "../pricing.js";
import { TICKET_FILES, loadTickets, ticketKey } from "../simulation-tickets.js";

type Destination = TriageScope | TriageCategory;
const DESTINATIONS: readonly Destination[] = ["not_it", "needs_human", "network", "security", "identity", "mdm", "knowledge", "endpoint"];

interface GroundTruthEntry {
  scope: TriageScope;
  category: TriageCategory | null;
  ambiguous?: true;
}

interface TicketOutcome {
  key: string;
  source: string;
  ambiguous: boolean;
  text: string;
  expected: Destination;
  actual: Destination | "triage_failed";
  correct: boolean;
  inputTokens: number;
  outputTokens: number;
}

function destinationOf(scope: TriageScope, category: TriageCategory | null): Destination {
  return scope === "routable" ? category! : scope;
}

function loadGroundTruth(path: string): Map<string, GroundTruthEntry> {
  const raw = JSON.parse(readFileSync(resolve(path), "utf8")) as Record<string, GroundTruthEntry>;
  return new Map(Object.entries(raw));
}

/** "d2" for a source-prefixed id ("d2-T031"); otherwise the file's own name, so a multi-file run still splits by file. */
function sourceOf(loaded: { sourceFile: string; ticket: { id: string } }): string {
  const prefixed = /^([a-z]+[0-9]+)-/i.exec(loaded.ticket.id);
  return prefixed ? prefixed[1]! : basename(loaded.sourceFile);
}

function pct(correct: number, total: number): string {
  return total === 0 ? "n/a" : `${((correct / total) * 100).toFixed(1)}%`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  ensureEnvLoaded();
  const { values } = parseArgs({ options: { label: { type: "string" }, model: { type: "string" }, overwrite: { type: "boolean" }, tickets: { type: "string" }, labels: { type: "string" } }, strict: true });
  const label = values.label ?? "baseline";
  // Refused up front, before any API spend: a re-run under an existing label used to replace that
  // label's evidence silently, which is how this project's first 125/150 result file for the
  // sharpened prompt was lost to a later 122/150 run of the same prompt.
  for (const ext of ["md", "json"]) {
    const existing = resolve(`evidence/triage-harness-${label}.${ext}`);
    if (existsSync(existing) && !values.overwrite) {
      throw new Error(`${existing} already exists — pick a new --label, or pass --overwrite to replace it deliberately`);
    }
  }
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const model = values.model ?? process.env.HELPDESK_TRIAGE_MODEL;
  const classifier = createTriageClassifier({ apiKey, ...(model ? { model } : {}) });

  const ticketFiles = values.tickets ? values.tickets.split(",").map((f) => f.trim()).filter(Boolean) : [...TICKET_FILES];
  const labelFile = values.labels ?? "test/triage-ground-truth.json";
  const tickets = loadTickets(ticketFiles);
  const groundTruth = loadGroundTruth(labelFile);
  const missing = tickets.filter((t) => !groundTruth.has(ticketKey(t)));
  if (missing.length > 0) {
    throw new Error(`${labelFile} is missing ${missing.length} ticket(s), e.g. ${ticketKey(missing[0]!)}`);
  }

  const outcomes: TicketOutcome[] = [];
  const modelsSeen = new Set<string>();
  let processed = 0;
  for (const loaded of tickets) {
    const key = ticketKey(loaded);
    const truth = groundTruth.get(key)!;
    const expected = destinationOf(truth.scope, truth.category);

    let actual: Destination | "triage_failed";
    let inputTokens = 0;
    let outputTokens = 0;
    let calledModel = model ?? "";
    try {
      const result = await classifier.classify(loaded.ticket.text);
      actual = destinationOf(result.scope, result.category);
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
      calledModel = result.model;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stopping = runStoppingReason(message);
      if (stopping) {
        console.error(`\n[triage-harness] STOPPING at ${key}: ${stopping}`);
        console.error(`[triage-harness] ${processed}/${tickets.length} processed before stopping — nothing written, re-run to start over.`);
        process.exit(1);
      }
      // Anything else (TriageError's own invalid_output/api_error/network codes, or any other
      // failure classify() surfaces) is an operational fault, not a ground-truth mismatch — the
      // same distinction bin/simulate.ts's own catch block draws, scored as its own outcome
      // rather than silently skipped or counted as a wrong category.
      console.error(`[triage-harness] ${key} failed: ${message}`);
      actual = "triage_failed";
    }

    if (calledModel) modelsSeen.add(calledModel);
    outcomes.push({ key, source: sourceOf(loaded), ambiguous: truth.ambiguous === true, text: loaded.ticket.text, expected, actual, correct: actual === expected, inputTokens, outputTokens });
    processed++;
    if (processed % 25 === 0) console.error(`[triage-harness] ${processed}/${tickets.length}`);
    await sleep(150);
  }

  const overallCorrect = outcomes.filter((o) => o.correct).length;
  const totalInputTokens = outcomes.reduce((sum, o) => sum + o.inputTokens, 0);
  const totalOutputTokens = outcomes.reduce((sum, o) => sum + o.outputTokens, 0);
  // priceUsage() needs one model name; every row of a single run shares the same requested
  // model, so the first one actually seen stands in for the whole run's own price lookup.
  const pricedModel = [...modelsSeen][0] ?? model ?? "";
  const totalCostUsd = priceUsage(pricedModel, totalInputTokens, totalOutputTokens);

  const byDestination = new Map<Destination, { correct: number; total: number; misclassifiedAs: Map<string, number> }>();
  for (const dest of DESTINATIONS) byDestination.set(dest, { correct: 0, total: 0, misclassifiedAs: new Map() });
  for (const o of outcomes) {
    const bucket = byDestination.get(o.expected as Destination);
    if (!bucket) continue; // expected should always be one of DESTINATIONS
    bucket.total++;
    if (o.correct) bucket.correct++;
    else bucket.misclassifiedAs.set(o.actual, (bucket.misclassifiedAs.get(o.actual) ?? 0) + 1);
  }

  const costLine =
    totalCostUsd === null
      ? `no price on file for \`${pricedModel}\` (see pricing.ts) — ${totalInputTokens} input / ${totalOutputTokens} output tokens, unpriced`
      : `$${totalCostUsd.toFixed(4)} total (${totalInputTokens} input / ${totalOutputTokens} output tokens, \`${pricedModel}\`), $${((totalCostUsd / outcomes.length) * 1000).toFixed(4)} per 1,000 requests`;

  const lines: string[] = [];
  lines.push(`# Triage-only accuracy harness — ${label}`);
  lines.push("");
  lines.push(`Classification alone, no agents, no gateways. Model: \`${model ?? "(default)"}\`. Tickets: ${ticketFiles.map((f) => `\`${f}\``).join(", ")}; labels: \`${labelFile}\`.`);
  lines.push("");
  lines.push(`**Overall: ${overallCorrect}/${outcomes.length} (${((overallCorrect / outcomes.length) * 100).toFixed(1)}%)**`);
  lines.push("");
  lines.push(`**Cost:** ${costLine}`);
  lines.push("");
  lines.push("| Destination | Correct | Total | Accuracy | Misclassified as |");
  lines.push("|---|---|---|---|---|");
  for (const dest of DESTINATIONS) {
    const b = byDestination.get(dest)!;
    const wrong = [...b.misclassifiedAs.entries()]
      .sort((a, c) => c[1] - a[1])
      .map(([d, n]) => `${d} (${n})`)
      .join(", ");
    lines.push(`| ${dest} | ${b.correct} | ${b.total} | ${pct(b.correct, b.total)} | ${wrong || "—"} |`);
  }
  lines.push("");
  const firm = outcomes.filter((o) => !o.ambiguous);
  const judgement = outcomes.filter((o) => o.ambiguous);
  if (judgement.length > 0) {
    lines.push("## Firm labels and judgement calls");
    lines.push("");
    lines.push("| Labels | Correct | Total | Accuracy |");
    lines.push("|---|---|---|---|");
    lines.push(`| firm | ${firm.filter((o) => o.correct).length} | ${firm.length} | ${pct(firm.filter((o) => o.correct).length, firm.length)} |`);
    lines.push(`| judgement calls | ${judgement.filter((o) => o.correct).length} | ${judgement.length} | ${pct(judgement.filter((o) => o.correct).length, judgement.length)} |`);
    lines.push("");
  }
  const sources = [...new Set(outcomes.map((o) => o.source))];
  if (sources.length > 1) {
    lines.push("## By source");
    lines.push("");
    lines.push("| Source | Correct | Total | Accuracy | Firm-label accuracy |");
    lines.push("|---|---|---|---|---|");
    for (const source of sources) {
      const rows = outcomes.filter((o) => o.source === source);
      const ok = rows.filter((o) => o.correct).length;
      const rowsFirm = rows.filter((o) => !o.ambiguous);
      lines.push(`| ${source} | ${ok} | ${rows.length} | ${pct(ok, rows.length)} | ${rowsFirm.filter((o) => o.correct).length}/${rowsFirm.length} (${pct(rowsFirm.filter((o) => o.correct).length, rowsFirm.length)}) |`);
    }
    lines.push("");
  }
  lines.push("## Every misclassified ticket");
  lines.push("");
  lines.push("| Ticket | Text | Expected | Actual | Label |");
  lines.push("|---|---|---|---|---|");
  for (const o of outcomes) {
    if (o.correct) continue;
    const text = o.text.length > 80 ? o.text.slice(0, 77) + "..." : o.text;
    lines.push(`| ${o.key} | ${text.replace(/\|/g, "\\|")} | ${o.expected} | ${o.actual} | ${o.ambiguous ? "judgement call" : "firm"} |`);
  }
  lines.push("");

  const outPath = resolve(`evidence/triage-harness-${label}.md`);
  writeFileSync(outPath, lines.join("\n"), "utf8");
  writeFileSync(resolve(`evidence/triage-harness-${label}.json`), JSON.stringify(outcomes, null, 1), "utf8");
  console.error(`\n[triage-harness] ${overallCorrect}/${outcomes.length} (${((overallCorrect / outcomes.length) * 100).toFixed(1)}%), ${costLine} — wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
