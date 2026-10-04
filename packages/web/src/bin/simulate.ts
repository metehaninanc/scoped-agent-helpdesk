/**
 * Sprint 4 prep, independent of that sprint's own spec: submit all 150 simulation tickets
 * (test/sim_records{1,2,3}.json) through the real entry point — routeRequest(), the same function
 * packages/web/src/request-page.ts calls for a real web form submission — against a dedicated set
 * of five databases (data/sim-*.db by default) so this run's evidence never mixes with or
 * overwrites the five chains under data/ that carry every verification run from Sprints 1 through 3.
 *
 *   pnpm simulate [--tag <name>] [--limit <n>] [--tickets <file[,file]> --actor-mapping <file>]
 *
 * --tickets names the ticket file(s) to submit instead of the three sim_records files, and --actor-mapping the
 * synthetic-address-to-real-user file that goes with them. Pass five (the dataset2 pass) used both:
 * `--tag 5 --tickets test/dataset2.json --actor-mapping test/actor-mapping-dataset2.json`. A mapping is a
 * property of a ticket set, built once by the same round-robin over the same four real users and then committed,
 * so a different ticket set needs its own file and the original is never touched.
 *
 * --tag names a second (third, ...) independent run against its own databases and its own results
 * file, so a later pass can sit side by side with an earlier one rather than overwriting it: with
 * `--tag 2`, databases are data/sim2-*.db and results go to
 * evidence/simulation-results-2.jsonl. The actor mapping is never tagged — test/actor-mapping.json
 * is shared by every pass, deliberately, so "the same actor mapping" is a property of the file
 * being reused, not re-derived per run.
 *
 * One Agent SDK turn per ticket, exactly what routeRequest() already does per call — there is no
 * multi-turn loop anywhere in this codebase to add one to, so "do not answer clarifying questions"
 * holds by construction, not by a check this file adds. Sequential, with a small delay
 * (SIM_DELAY_MS, default 1500ms) between tickets, and resumable within one tag: every completed
 * ticket is appended to that tag's results file as soon as it finishes, and a ticket already
 * present there (by sourceFile + id, since ids repeat across the three files) is skipped on the
 * next invocation of the same tag rather than resubmitted.
 *
 * This file never reads a ticket's actualNeed field — see simulation-tickets.ts, which drops it
 * before a ticket's own type can carry it this far.
 *
 * The four sim gateways for this tag must already be running against that tag's db paths and
 * ports before this runs — see README.md, "Sprint 4 simulation notes", for the exact commands.
 * This file talks to them the same way the real agents always do: through IDENTITY_GATEWAY_URL and
 * friends, read from this process's own environment, which must be set to the right ports before
 * this process starts (those env vars are read once, at module load time, by identity-agent.ts and
 * friends — setting them after import would be too late).
 *
 * SPRINT4.md, section 6: a usage/policy limit or an authentication failure (runStoppingReason(),
 * @helpdesk/agent) stops the run outright rather than being recorded as an ordinary per-ticket
 * "error" result. The two look identical from inside a single try/catch — both are the runner
 * failing to complete a call — but they are not the same kind of thing: a network blip on one
 * ticket says nothing about the next one, while a usage limit is a standing condition that will
 * keep firing on every remaining ticket until it clears. Recording the second kind as ordinary
 * "error" results (which is what the very first live run of this section did — 67 of 150 tickets,
 * this way, silently) means a pass could finish "successfully" while having actually scored
 * almost half its tickets as noise. Stopping is deliberately the louder, more disruptive choice.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { routeRequest, runStoppingReason } from "@helpdesk/agent";
import { AuditLog, type AuditRecord } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway-core";

import { loadOrBuildActorMapping } from "../simulation-actor-mapping.js";
import { unreachableGateways } from "../simulation-gateways.js";
import { triageStopReason } from "../simulation-stop.js";
import { loadTickets, ticketKey } from "../simulation-tickets.js";
import type { SimToolCall, TicketResult } from "../simulation-types.js";

/** data/sim-*.db with no tag; data/sim<tag>-*.db with one — see file header. */
export function simDbPaths(tag?: string): Record<"orchestrator" | "identity" | "mdm" | "knowledge" | "endpoint", string> {
  const prefix = tag ? `sim${tag}` : "sim";
  return {
    orchestrator: resolve(`data/${prefix}-orchestrator.db`),
    identity: resolve(`data/${prefix}-identity.db`),
    mdm: resolve(`data/${prefix}-mdm.db`),
    knowledge: resolve(`data/${prefix}-knowledge.db`),
    endpoint: resolve(`data/${prefix}-endpoint.db`),
  };
}

/** evidence/simulation-results.jsonl with no tag; evidence/simulation-results-<tag>.jsonl with one. */
export function resultsPath(tag?: string): string {
  return resolve(tag ? `evidence/simulation-results-${tag}.jsonl` : "evidence/simulation-results.jsonl");
}

/** evidence/simulation-summary.md with no tag; evidence/simulation-summary-<tag>.md with one. */
export function summaryPath(tag?: string): string {
  return resolve(tag ? `evidence/simulation-summary-${tag}.md` : "evidence/simulation-summary.md");
}

const DELAY_MS = Number.parseInt(process.env.SIM_DELAY_MS ?? "1500", 10);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readExistingKeys(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
  return new Set(
    lines.map((line) => {
      const r = JSON.parse(line) as Pick<TicketResult, "sourceFile" | "id">;
      return `${r.sourceFile}#${r.id}`;
    }),
  );
}

/**
 * A tool call this ticket's turn produced, from the sim gateway's own chain — never re-derived
 * from routeRequest()'s return value, which does not carry tool name or policy decision at all.
 * autonomous is written twice per call by tool-call.ts (once before execution, result null; once
 * after, result set) — kept here only once, via the result === null write, to avoid double
 * counting; approval and denied are always written exactly once.
 */
function toolCallsFor(log: AuditLog, requestId: string): SimToolCall[] {
  const isToolDecision = (r: AuditRecord): boolean =>
    r.tool !== null && (r.decision === "denied" || r.decision === "approval" || (r.decision === "autonomous" && r.result === null));
  return log
    .byRequest(requestId)
    .filter(isToolDecision)
    .map((r) => ({ tool: r.tool!, decision: r.decision as SimToolCall["decision"], rules: r.rules }));
}

async function main(): Promise<void> {
  // --limit caps how many NEW tickets this invocation submits — for a cheap smoke test before
  // committing to the full file, never for skipping tickets that look out of scope; resumability
  // means a later invocation with no --limit still picks up everything this one left undone.
  // --tag names an independent, side-by-side run — see file header.
  const { values } = parseArgs({ options: { limit: { type: "string" }, tag: { type: "string" }, tickets: { type: "string" }, "actor-mapping": { type: "string" } }, strict: true });
  const limit = values.limit !== undefined ? Number.parseInt(values.limit, 10) : undefined;
  const tag = values.tag;

  const SIM_DB_PATHS = simDbPaths(tag);
  const RESULTS_PATH = resultsPath(tag);

  mkdirSync(dirname(RESULTS_PATH), { recursive: true });

  const ticketFiles = values.tickets ? values.tickets.split(",").map((f) => f.trim()).filter(Boolean) : undefined;
  if (ticketFiles && !values["actor-mapping"]) throw new Error("--tickets needs its own --actor-mapping: the original mapping covers the original tickets only");
  const loaded = loadTickets(ticketFiles);
  const distinctAddresses = [...new Set(loaded.map((l) => l.ticket.submittedBy))];
  const mapping = loadOrBuildActorMapping(resolve(values["actor-mapping"] ?? "test/actor-mapping.json"), distinctAddresses);

  const alreadyDone = readExistingKeys(RESULTS_PATH);
  console.error(`[simulate]${tag ? ` [tag ${tag}]` : ""} ${loaded.length} ticket(s) total, ${alreadyDone.size} already recorded, ${loaded.length - alreadyDone.size} remaining`);
  if (limit !== undefined) console.error(`[simulate] --limit ${limit}: this invocation will stop after ${limit} new ticket(s)`);

  const gatewayLogs = {
    identity: new AuditLog(openDatabase(SIM_DB_PATHS.identity)),
    mdm: new AuditLog(openDatabase(SIM_DB_PATHS.mdm)),
    knowledge: new AuditLog(openDatabase(SIM_DB_PATHS.knowledge)),
    endpoint: new AuditLog(openDatabase(SIM_DB_PATHS.endpoint)),
  } as const;

  // The origins the four agents themselves connect to (each agent reads the same variable and
  // default at module load) — see simulation-gateways.ts for why a dead one must stop the run.
  const GATEWAY_URLS = [
    process.env.IDENTITY_GATEWAY_URL ?? "http://127.0.0.1:3001",
    process.env.MDM_GATEWAY_URL ?? "http://127.0.0.1:3002",
    process.env.KNOWLEDGE_GATEWAY_URL ?? "http://127.0.0.1:3003",
    process.env.ENDPOINT_GATEWAY_URL ?? "http://127.0.0.1:3004",
  ];
  const stopIfGatewayDown = async (key: string, when: string): Promise<void> => {
    const down = await unreachableGateways(GATEWAY_URLS);
    if (down.length === 0) return;
    console.error(
      `[simulate] STOPPING at ${key}: gateway(s) not accepting connections ${when}: ${down.join(", ")}. A ticket recorded now would score the agent's missing tools as the system's behaviour; nothing further attempted or recorded. Restart the gateways and resume with the same --tag.`,
    );
    throw new Error(`gateway unreachable ${when}: ${down.join(", ")}`);
  };

  let processed = 0;
  try {
    for (const { ticket, sourceFile } of loaded) {
      if (limit !== undefined && processed >= limit) break;

      const key = ticketKey({ ticket, sourceFile });
      if (alreadyDone.has(key)) continue;

      const actor = mapping[ticket.submittedBy];
      if (!actor) throw new Error(`no actor mapping entry for ${ticket.submittedBy} (${key})`);

      await stopIfGatewayDown(key, "before the ticket");

      let result: TicketResult;
      try {
        const routed = await routeRequest({
          actor,
          requestText: ticket.text,
          dbPath: SIM_DB_PATHS.orchestrator,
          identityDbPath: SIM_DB_PATHS.identity,
          mdmDbPath: SIM_DB_PATHS.mdm,
          knowledgeDbPath: SIM_DB_PATHS.knowledge,
          endpointDbPath: SIM_DB_PATHS.endpoint,
        });

        if (routed.status === "routed") {
          const toolCalls = toolCallsFor(gatewayLogs[routed.category], routed.requestId);
          const last = toolCalls.at(-1) ?? null;
          result = {
            id: ticket.id,
            sourceFile,
            submittedBy: ticket.submittedBy,
            actor,
            requestId: routed.requestId,
            category: routed.category,
            partiallyOutOfScope: routed.note !== undefined,
            agentInvoked: routed.agent,
            toolCalled: routed.toolWasCalled,
            toolCalls,
            toolName: last?.tool ?? null,
            policyDecision: last?.decision ?? null,
            policyRules: last?.rules ?? [],
            reply: routed.reply,
          };
        } else if (routed.status === "not_it" || routed.status === "needs_human" || routed.status === "network" || routed.status === "security") {
          // SPRINT4.md, section 1 split the old, single "unsupported" outcome into these two —
          // category takes routed.status directly (SimCategory has carried both since that
          // split) rather than collapsing them back into one bucket a later pass would need to
          // undo again.
          result = {
            id: ticket.id,
            sourceFile,
            submittedBy: ticket.submittedBy,
            actor,
            requestId: routed.requestId,
            category: routed.status,
            partiallyOutOfScope: routed.note !== undefined,
            agentInvoked: null,
            toolCalled: false,
            toolCalls: [],
            toolName: null,
            policyDecision: null,
            policyRules: [],
            reply: routed.message,
          };
        } else {
          // routeRequest() swallows a triage error into this result instead of throwing it, so the
          // catch block below never sees a billing refusal or a 401 on the classification call —
          // rethrown here, with the original text, so it takes the same stop-and-log path an
          // agent's usage limit does. See simulation-stop.ts.
          if (triageStopReason(routed)) throw new Error(routed.cause);
          result = {
            id: ticket.id,
            sourceFile,
            submittedBy: ticket.submittedBy,
            actor,
            requestId: routed.requestId,
            category: "triage_failed",
            partiallyOutOfScope: null,
            agentInvoked: null,
            toolCalled: false,
            toolCalls: [],
            toolName: null,
            policyDecision: null,
            policyRules: [],
            reply: routed.message,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stopReason = runStoppingReason(message);
        if (stopReason) {
          // Not a ticket outcome at all: a standing condition on this credential or account that
          // will keep firing on every remaining ticket. Stop here, loudly, rather than let the
          // run "finish" having quietly scored the rest of the pass as noise — see file header.
          console.error(
            `[simulate] STOPPING at ${key}: ${stopReason}. ${processed} ticket(s) recorded this run before stopping; nothing further attempted or recorded. Resume with the same --tag once this clears.`,
          );
          throw error;
        }

        // Anything else — a network blip, a credential this run's own gateways rejected, ... —
        // is a ticket the runner itself could not complete: data, not noise, recorded and moved
        // past, never retried, never silently skipped.
        result = {
          id: ticket.id,
          sourceFile,
          submittedBy: ticket.submittedBy,
          actor,
          requestId: null,
          category: "error",
          partiallyOutOfScope: null,
          agentInvoked: null,
          toolCalled: false,
          toolCalls: [],
          toolName: null,
          policyDecision: null,
          policyRules: [],
          reply: "",
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        };
      }

      // A gateway that died during the ticket leaves no error to catch — the agent just reports its
      // tools missing — so a ticket an agent handled is only recorded if they are still up.
      if (result.agentInvoked !== null) await stopIfGatewayDown(key, "after the ticket");

      appendFileSync(RESULTS_PATH, `${JSON.stringify(result)}\n`, "utf8");
      processed++;
      console.error(`[simulate] ${key} -> ${result.category}${result.error ? ` ERROR: ${result.error.split("\n")[0]}` : ""}`);

      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  } finally {
    for (const log of Object.values(gatewayLogs)) log.close();
  }

  console.error(`[simulate] done: ${processed} new ticket(s) processed this run, ${alreadyDone.size + processed}/${loaded.length} total recorded`);
}

// Guarded, unlike a script meant only to be run directly: simulate-summary.ts and
// simulate-compare.ts both import simDbPaths/resultsPath/summaryPath from this same file, and an
// unguarded call here would resubmit every unrecorded ticket as a side effect of asking for a
// summary — exactly the kind of thing "no shortcut, no unexpected side effect" is supposed to
// prevent, not cause.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
}
