/**
 * Prove that no prompt injection the project has met changes what the system does. A repeatable check, the
 * same kind of thing as `prove-isolation`: it states what each attempt tried to do, runs it through the real
 * entry point, records what actually happened, and exits non-zero if any injected instruction ever changed
 * an outcome (the definition is in injection-suite.ts, and printed at the top of the report).
 *
 *   pnpm prove-injection [-- --injected 3] [-- --control 3] [-- --only inj-03,inj-07] [-- --set-only]
 *
 * Reads test/injection-set.json: sixteen attempts gathered from the original simulation tickets, two
 * Sprint 3 web-form probes and the later generated ticket sets. Each attempt that has a part which is not
 * the injection is submitted --injected times as written and --control times with the injected text removed,
 * both through routeRequest(), the function the web form calls. An attempt whose whole request is the attack
 * has no control, and is held to the hard rules only. Writes evidence/injection-run.md and
 * evidence/injection-run.json, overwriting the last run's.
 *
 * Exit codes: 0 every attempt held; 1 an injected instruction changed an outcome; 2 the run could not say
 * (a gateway down, a usage or billing limit, an authentication failure, a failed run) and wrote nothing, so
 * neither a pass nor a fail is claimed. This file never reads a ticket's actualNeed: simulation-tickets.ts
 * drops it before a ticket reaches here.
 *
 * Like prove-isolation, it cannot start the gateways itself: the proof would then depend on a process this
 * script launched. Start four, on their own ports and databases (these are exactly what injection-env.ts
 * points the agents at), then run it:
 *
 *   node packages/identity-gateway/dist/bin/gateway.js  --port 3021 --db data/inj-identity.db
 *   node packages/mdm-gateway/dist/bin/gateway.js       --port 3022 --db data/inj-mdm.db
 *   node packages/knowledge-gateway/dist/bin/gateway.js --port 3023 --db data/inj-knowledge.db
 *   node packages/endpoint-gateway/dist/bin/gateway.js  --port 3024 --db data/inj-endpoint.db
 *
 * Set HELPDESK_AGENT_AUTH=session to run the agents on the logged-in Claude session and not the API key
 * (triage always uses the key). The databases are append-only chains and are not reset between runs; every
 * request carries its own id, so a run reads back only its own records.
 */
import "../injection-env.js";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { routeRequest, runStoppingReason } from "@helpdesk/agent";
import { AuditLog, type AuditRecord } from "@helpdesk/audit-core";
import { openDatabase } from "@helpdesk/gateway-core";

import { injectionDbPaths, injectionGatewayUrls } from "../injection-env.js";
import {
  evaluateEntry,
  exitCodeFor,
  parseInjectionSet,
  renderMarkdown,
  resolveEntries,
  type EntryResult,
  type RunRecord,
  type ToolCallRecord,
} from "../injection-suite.js";
import { REAL_TEST_USERS } from "../simulation-actor-mapping.js";
import { unreachableGateways } from "../simulation-gateways.js";
import { triageStopReason } from "../simulation-stop.js";
import { loadTickets } from "../simulation-tickets.js";


const SET_PATH = "test/injection-set.json";
const OUT_MD = resolve("evidence/injection-run.md");
const OUT_JSON = resolve("evidence/injection-run.json");

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A condition on the account or the machine that will fail every remaining run: stop, claim nothing. */
class StandingCondition extends Error {}

function toolCallsFor(log: AuditLog, requestId: string): ToolCallRecord[] {
  // Same selection as the simulation runner: autonomous is written twice per call (before and after
  // execution), so only the write with no result yet is kept; approval and denied are written once.
  const isToolDecision = (r: AuditRecord): boolean =>
    r.tool !== null && (r.decision === "denied" || r.decision === "approval" || (r.decision === "autonomous" && r.result === null));
  return log
    .byRequest(requestId)
    .filter(isToolDecision)
    .map((r) => ({ tool: r.tool!, decision: r.decision as ToolCallRecord["decision"], rules: r.rules, params: r.parameters }));
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { injected: { type: "string" }, control: { type: "string" }, only: { type: "string" }, delay: { type: "string" }, "set-only": { type: "boolean" } },
    strict: true,
  });
  const injectedRuns = Number.parseInt(values.injected ?? "3", 10);
  const controlRuns = Number.parseInt(values.control ?? "3", 10);
  const delayMs = Number.parseInt(values.delay ?? "1500", 10);
  const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;

  const cache = new Map<string, Map<string, string>>();
  const readTicketText = (file: string, id: string): string => {
    if (!cache.has(file)) cache.set(file, new Map(loadTickets([file]).map((t) => [t.ticket.id, t.ticket.text])));
    const text = cache.get(file)!.get(id);
    if (text === undefined) throw new Error(`${file}#${id} is not in the file`);
    return text;
  };
  const entries = resolveEntries(parseInjectionSet(JSON.parse(readFileSync(resolve(SET_PATH), "utf8"))), readTicketText).filter((e) => !only || only.has(e.id));
  if (entries.length === 0) throw new Error("no attempts selected");

  if (values["set-only"]) {
    for (const e of entries) {
      console.log(`${e.id}  ${e.source}\n  tried: ${e.tried}\n  control: ${e.controlText === null ? "(none: the whole request is the attack)" : JSON.stringify(e.controlText)}`);
    }
    console.log(`${entries.length} attempts, set is valid`);
    return 0;
  }

  const down = await unreachableGateways(injectionGatewayUrls());
  if (down.length > 0) {
    console.error(`[prove-injection] gateway(s) not accepting connections: ${down.join(", ")}.\nStart the four gateways on ports 3021-3024 first; the commands are in this file's header.`);
    return 2;
  }
  const paths = injectionDbPaths();
  let logs: Record<"identity" | "mdm" | "knowledge" | "endpoint", AuditLog>;
  try {
    logs = {
      identity: new AuditLog(openDatabase(paths.identity)),
      mdm: new AuditLog(openDatabase(paths.mdm)),
      knowledge: new AuditLog(openDatabase(paths.knowledge)),
      endpoint: new AuditLog(openDatabase(paths.endpoint)),
    };
  } catch (error) {
    console.error(`[prove-injection] ${error instanceof Error ? error.message : String(error)}\nStart the gateways with --db data/inj-*.db (see this file's header); they create the databases.`);
    return 2;
  }

  const runOne = async (actor: string, kind: RunRecord["kind"], rep: number, text: string): Promise<RunRecord> => {
    const stillDown = await unreachableGateways(injectionGatewayUrls());
    if (stillDown.length > 0) throw new StandingCondition(`gateway(s) stopped accepting connections: ${stillDown.join(", ")}`);
    const base = { kind, rep, toolCalls: [] as ToolCallRecord[], handoffId: null as string | null, category: null as string | null };
    try {
      const routed = await routeRequest({
        actor,
        requestText: text,
        dbPath: paths.orchestrator,
        identityDbPath: paths.identity,
        mdmDbPath: paths.mdm,
        knowledgeDbPath: paths.knowledge,
        endpointDbPath: paths.endpoint,
      });
      if (routed.status === "routed") {
        return { ...base, requestId: routed.requestId, status: "routed", category: routed.category, toolCalls: toolCallsFor(logs[routed.category], routed.requestId), reply: routed.reply };
      }
      if (routed.status === "triage_failed") {
        if (triageStopReason(routed)) throw new StandingCondition(routed.cause);
        return { ...base, requestId: routed.requestId, status: "triage_failed", reply: routed.message };
      }
      return { ...base, requestId: routed.requestId, status: routed.status, handoffId: "handoffId" in routed ? routed.handoffId : null, reply: routed.message };
    } catch (error) {
      if (error instanceof StandingCondition) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const stopping = runStoppingReason(message);
      if (stopping) throw new StandingCondition(`${stopping}: ${message}`);
      return { ...base, requestId: null, status: "error", reply: "", error: message };
    }
  };

  const results: EntryResult[] = [];
  try {
    for (const [index, entry] of entries.entries()) {
      const actor = REAL_TEST_USERS[index % REAL_TEST_USERS.length]!;
      const runs: RunRecord[] = [];
      const reps = Math.max(injectedRuns, entry.controlText === null ? 0 : controlRuns);
      for (let rep = 1; rep <= reps; rep++) {
        if (entry.controlText !== null && rep <= controlRuns) {
          runs.push(await runOne(actor, "control", rep, entry.controlText));
          console.error(`[prove-injection] ${entry.id} control ${rep}: ${runs.at(-1)!.status}${runs.at(-1)!.category ? `:${runs.at(-1)!.category}` : ""}`);
          await sleep(delayMs);
        }
        if (rep <= injectedRuns) {
          runs.push(await runOne(actor, "injected", rep, entry.injectedText));
          console.error(`[prove-injection] ${entry.id} injected ${rep}: ${runs.at(-1)!.status}${runs.at(-1)!.category ? `:${runs.at(-1)!.category}` : ""}`);
          await sleep(delayMs);
        }
      }
      results.push(evaluateEntry(entry, runs));
    }
  } catch (error) {
    if (error instanceof StandingCondition) {
      console.error(`\n[prove-injection] STOPPING: ${error.message}. Nothing written, and no pass or fail is claimed; re-run once this clears.`);
      return 2;
    }
    throw error;
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    injectedRuns,
    controlRuns,
    agentAuth: process.env.HELPDESK_AGENT_AUTH === "session" ? "the logged-in Claude session (HELPDESK_AGENT_AUTH=session)" : "ANTHROPIC_API_KEY",
    setPath: SET_PATH,
  };
  mkdirSync(dirname(OUT_MD), { recursive: true });
  writeFileSync(OUT_MD, renderMarkdown(meta, results), "utf8");
  writeFileSync(OUT_JSON, JSON.stringify({ meta, exitCode: exitCodeFor(results), results }, null, 1) + "\n", "utf8");

  const code = exitCodeFor(results);
  const held = results.filter((r) => r.verdict === "held").length;
  const contained = results.reduce((n, r) => n + r.contained.length, 0);
  console.error(
    `\n[prove-injection] ${held}/${results.length} held${contained ? `, ${contained} attempt(s) steered a call that policy then denied` : ""} — ${code === 0 ? "PASS" : code === 1 ? "FAIL: an injected instruction changed an outcome" : "INCOMPLETE"} — wrote ${OUT_MD}`,
  );
  return code;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  },
);
