# Running it in full

Prerequisites, the environment file, the four gateways and every command, as the project documented them.

Section titles quoted in the text, such as "Endpoint gateway notes", are the titles from the project's original single-file README; [the index](README.md) says where each one is now.

## Running it

**Node 22.13 or newer is required.** The audit log uses the built in `node:sqlite` module,
which was unflagged in Node 22.13.0
([nodejs/node#55890](https://github.com/nodejs/node/pull/55890)); before that it either does not
exist or needs `--experimental-sqlite`. `openDatabase()` checks the running Node version at
startup and fails with a clear message rather than a cryptic import error. It still prints an
`ExperimentalWarning` on 22.x; the scripts in this repo run with `--no-warnings=ExperimentalWarning`
to suppress it. Nothing here is native code, so there is no build step and no `build-essential`
requirement on Linux; a Linux VPS should still use the NodeSource 22.x repository, `nvm`, or the
official tarball rather than a distro package, which is often older.

pnpm 12 manages the workspace (`npm install -g pnpm`; corepack could not write to Program Files
on the machine this was built on, hence the plain global install).

```
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Copy `.env.example` to `.env` and fill it in. `AZURE_TENANT_ID` is shared, one directory; each
gateway and each agent gets its own client id, certificate thumbprint and PEM private key path
(kept outside the repo) — the identity and MDM gateways' own Graph-scoped credentials
(`AZURE_IDENTITY_*` / `AZURE_MDM_*`), each gateway's own Application ID URI
(`IDENTITY_GATEWAY_AUDIENCE` / `MDM_GATEWAY_AUDIENCE` / `KNOWLEDGE_GATEWAY_AUDIENCE` /
`ENDPOINT_GATEWAY_AUDIENCE`), and each agent's own certificate, scoped to its gateway's audience
and carrying no Graph permission (`AZURE_IDENTITY_AGENT_*` / `AZURE_MDM_AGENT_*` /
`AZURE_KNOWLEDGE_AGENT_*` / `AZURE_ENDPOINT_AGENT_*`, SPRINT2.md Stage B, extended for the third
and fourth agents in SPRINT3.md 3.3 and 3.4). The knowledge and endpoint gateways themselves need
no client id or certificate of any kind — only their own tenant id and audience — since neither
holds a credential at all, for two different reasons (see "Knowledge gateway notes" and "Endpoint
gateway notes" below). `ANTHROPIC_API_KEY` is optional for the approval rationale specifically —
without it, identity's approvals are still created, just without a generated rationale, and the
gateway says so at startup — but as of SPRINT3.md 3.1 it is required for the web app to do
anything at all: triage's classification call needs it to route a single request, and there is no
fallback path that skips triage. Real environment variables always take precedence over `.env`.
Every agent's own model turns also need `ANTHROPIC_API_KEY` to resolve, but through a separate
mechanism: the Agent SDK's own Claude Code subprocess, which can authenticate from the same `.env`
(the agent package loads it independently at its own startup), a real environment variable, or an
`ant auth login` profile. By default that key reaches the agents' subprocess, which is how every pass
through pass three ran; `HELPDESK_AGENT_AUTH=session` withholds it from the agents' subprocess only,
so they use the machine's logged-in Claude session instead, and every agent call then checks the SDK's
reported `apiKeySource` is `none` (README, "Simulation run (Sprint 4 — pass four)").

**All four gateways are long-running HTTP servers, not one process per agent session.** Start
them first, in their own terminals, before running an agent or the web app — there is nothing
left for any of them to spawn:

```
pnpm identity-gateway [--port 3001] [--db data/identity-helpdesk.db]
pnpm mdm-gateway [--port 3002] [--db data/mdm-helpdesk.db]
pnpm knowledge-gateway [--port 3003] [--db data/knowledge-helpdesk.db]
pnpm endpoint-gateway [--port 3004] [--db data/endpoint-helpdesk.db]
```

With all four running, everything else can be run directly once built:

```
pnpm agent --actor alice@contoso.com --request "which groups is alice@contoso.com in"
pnpm mdm-agent --actor alice@contoso.com --request "list the devices in the tenant"
pnpm knowledge-agent --actor alice@contoso.com --request "what are Intune's three pillars?"
pnpm endpoint-agent --actor alice@contoso.com --request "list the endpoints"
pnpm route --actor alice@contoso.com --request "which groups is alice@contoso.com in"
pnpm web
pnpm verify-audit [path/to/identity-helpdesk.db]
pnpm graph-smoke
pnpm mdm-graph-smoke
pnpm token-smoke
pnpm prove-isolation
```

No `--` before the flags: these scripts chain a build step before `node ...` with `&&`, and on
this pnpm version a `--` separator is passed straight through as a literal argument to the built
script, which then rejects it. Plain trailing flags work because pnpm appends them to the whole
script line.

`pnpm mdm-gateway`, `pnpm knowledge-gateway` and `pnpm endpoint-gateway` default to
`data/mdm-helpdesk.db`, `data/knowledge-helpdesk.db` and `data/endpoint-helpdesk.db` respectively,
each a separate file from the identity gateway's `data/identity-helpdesk.db` (SPRINT2.md,
Component 6: two gateways, two audit chains, never merged — extended to three in SPRINT3.md 3.3,
four in 3.4); `pnpm verify-audit` takes any of the four paths and needs no changes to work against
any of them. `pnpm prove-isolation`'s gateway-level checks need all four gateways already running
and reachable — see its own header comment. The web app itself needs both the identity and
endpoint agents' credentials, plus `ENDPOINT_HELPDESK_DB_PATH` (default
`data/endpoint-helpdesk.db`) alongside `HELPDESK_DB_PATH`, since as of 3.4 it reads and decides
approvals on both gateways, not one (see "Web app notes" below). As of 3.5, it also reads (never
writes) the orchestrator's, MDM's and knowledge's own databases for the dashboard —
`ORCHESTRATOR_DB_PATH`, `MDM_HELPDESK_DB_PATH`, `KNOWLEDGE_HELPDESK_DB_PATH`, each defaulting to
that chain's own default path, so nothing new needs setting for a standard local setup (see
"Dashboard notes" below).

`pnpm route` (SPRINT3.md 3.1, `packages/agent/src/orchestrator.ts`) is what `pnpm web` now calls
into for every submitted request, exposed on its own as a CLI for the same reason `pnpm agent`,
`pnpm mdm-agent` and `pnpm knowledge-agent` are: to exercise triage and routing directly, against
`data/orchestrator.db` by default, without the web app in the way. `--identity-db`, `--mdm-db` and
`--knowledge-db` forward to whichever agent triage picks, the same way `pnpm web`'s own
`HELPDESK_DB_PATH` does internally.

## Every other command, checked from a fresh clone

Added when the README was split, and not part of the original "Running it" above. On 2026-10-04 each command below was run from a fresh clone of the pushed branch, with `.env` copied in and the data directory empty, and each worked as described. The four commands that are documented above (`pnpm install`, `build`, `test`, `typecheck`) work in any order from a clean checkout; `pnpm test` did not until the agent package's test script was fixed (see [findings.md](findings.md)). Pass flags without a `--` before them.

**Needs the four real gateways running (ports 3001 to 3004).** `pnpm prove-isolation` rewrites `evidence/isolation-run.txt` with its own run, so run it in a scratch clone, or restore the committed copy afterwards. `pnpm reset-password-smoke` needs the endpoint gateway. `pnpm graph-smoke`, `pnpm mdm-graph-smoke` and `pnpm token-smoke` only read from the tenant and need no gateway. `pnpm verify-audit [path]` defaults to `data/identity-helpdesk.db`.

**`pnpm prove-injection`** needs four more gateways, on their own ports and databases (these are what `injection-env.ts` points the agents at):

```
node packages/identity-gateway/dist/bin/gateway.js  --port 3021 --db data/inj-identity.db
node packages/mdm-gateway/dist/bin/gateway.js       --port 3022 --db data/inj-mdm.db
node packages/knowledge-gateway/dist/bin/gateway.js --port 3023 --db data/inj-knowledge.db
node packages/endpoint-gateway/dist/bin/gateway.js  --port 3024 --db data/inj-endpoint.db
HELPDESK_AGENT_AUTH=session pnpm prove-injection
```

`--only inj-05` runs one attempt, `--set-only` checks the set without a model call, and `--injected` and `--control` set the number of runs a side. A full run takes half an hour to an hour and overwrites `evidence/injection-run.md` and `.json`; a partial run overwrites them too, so run it in a scratch clone.

**`pnpm simulate`** will not start unless four gateways are already running against that run's own chains, and `*_GATEWAY_URL` must point at them before the runner starts. For `--tag 9`:

```
node packages/identity-gateway/dist/bin/gateway.js  --port 3011 --db data/sim9-identity.db
node packages/mdm-gateway/dist/bin/gateway.js       --port 3012 --db data/sim9-mdm.db
node packages/knowledge-gateway/dist/bin/gateway.js --port 3013 --db data/sim9-knowledge.db
node packages/endpoint-gateway/dist/bin/gateway.js  --port 3014 --db data/sim9-endpoint.db
IDENTITY_GATEWAY_URL=http://127.0.0.1:3011 MDM_GATEWAY_URL=http://127.0.0.1:3012 \
KNOWLEDGE_GATEWAY_URL=http://127.0.0.1:3013 ENDPOINT_GATEWAY_URL=http://127.0.0.1:3014 \
pnpm simulate --tag 9 --limit 1
```

Without `--tickets` it runs the original mixed ticket files; the final pass used `--tickets test/dataset2.json --actor-mapping test/actor-mapping-dataset2.json`. It is resumable, and writes `evidence/simulation-results-<tag>.jsonl`.

**Commands that need chains this repository does not hold.** The chains behind each pass are `data/*.db`, which are gitignored. `pnpm simulate-score`, `pnpm simulate-compare` and `pnpm simulate-summary` read them, so on a fresh clone they stop with "No audit database at data/sim...", which is the intended guard and not a fault. They work on a machine that ran the pass; the results they produced are the files in `evidence/`. `pnpm simulate-score` also reads the first pass's untagged chains unless given `--exclude-first`; scoring one pass on its own is `pnpm simulate-score --tags 5 --exclude-first --out <file>`.

**`pnpm triage-harness --label <name>`** classifies tickets with no agents and no gateways: `--tickets` and `--labels` name the ticket and label files, `--model` the model, and `--overwrite` replaces an existing label. On 2026-10-04, `--label tidy-check --tickets test/dataset2.json --labels test/dataset2-labels.json` scored 135 of 150 (90.0%) for $0.34, kept as `evidence/triage-harness-tidy-check.md`. It is one more draw on the in-sample set, run to check the command and not a new measurement.

**`pnpm record-walkthrough`** needs Chrome (`CHROME_PATH`) and ffmpeg (`FFMPEG`), starts its own private stack, and overwrites `evidence/walkthrough.mp4` and `.md`. Run with `--scenes title` it wrote a 0:12 video. `--scenes` takes the scene names and `--keep-frames` keeps the screenshots.

**`pnpm knowledge-reindex`** reports what the corpus folder holds, and **`pnpm knowledge-verify-citations`** checks every citation URL over the network, exits 1 if any does not resolve, and overwrites `evidence/knowledge-corpus-citations.txt`. Nine of the 25 now return 404; see "The documentation repositories that disappeared" in [findings.md](findings.md).
