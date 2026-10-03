/**
 * Records the five-minute walkthrough: a silent, captioned video of the real system doing its work.
 *
 *   pnpm record-walkthrough [-- --scenes title,resolves] [-- --keep-frames]
 *
 * It starts a private copy of the stack (four gateways on ports 3031-3034 against fresh data/demo-*.db
 * chains, and the web app on 3100), drives a headless Chrome over the DevTools protocol, takes screenshots,
 * and has ffmpeg turn them into evidence/walkthrough.mp4, with evidence/walkthrough.md listing the scenes
 * by video time. Nothing is mocked: every request goes through triage and a real agent, every page is the
 * running app's own, and the two terminal scenes run the real scripts and show their real output.
 *
 *   1. a request that resolves        a how-to question answered from the indexed documentation, with sources
 *   2. the approval gate              a group change that waits for a human, and a briefing requested for it
 *   3. a refusal by a named rule      the endpoint gateway's own denial, by rule name (see below)
 *   4. the operator console           an urgent security report above an older request, one taken and resolved
 *   5. the dashboard                  the five outcomes, the chains' integrity, the cost
 *   6. prove-isolation                the twenty-two checks, run
 *
 * What the recording shortens, and says it does: an agent turn takes tens of seconds, so waits are sped up
 * (captioned with the factor). What it does not do: choose requests to flatter the system. The scene 3 request
 * is not a chat message, because a well-prompted model never asks for what the policy engine must refuse
 * (README, "A live finding: a well-prompted model never gives the policy engine anything to refuse"); the
 * project proves that refusal directly, with `pnpm reset-password-smoke`, and so does this video.
 *
 * Needs: Chrome (CHROME_PATH, or the default install), ffmpeg on PATH (FFMPEG), the built packages, and the
 * .env the other live scripts use. Agents run on the logged-in Claude session (HELPDESK_AGENT_AUTH=session).
 * The demo databases are deleted at the start: they are the run's own and are gitignored.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { unreachableGateways } from "../simulation-gateways.js";
import { Timeline, mmss } from "../walkthrough-timeline.js";

const GATEWAY_PORTS = { identity: 3031, mdm: 3032, knowledge: 3033, endpoint: 3034 } as const;
const WEB_PORT = 3100;
const CDP_PORT = 9333;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT_VIDEO = resolve("evidence/walkthrough.mp4");
const OUT_NOTES = resolve("evidence/walkthrough.md");

const REQUESTER_RESOLVES = "alexdesouza@metehantestoutlook.onmicrosoft.com";
const REQUESTER_GATE = "helpdesk.operator@metehantestoutlook.onmicrosoft.com";
const REQUESTER_HANDOFF = "didierdrogba@metehantestoutlook.onmicrosoft.com";
const OPERATOR = "it.manager@contoso.com";

/** Reading time. Captions are a sentence or two, and a silent video has to leave room to read them: every deliberate hold is stretched by this factor; waits, typing and real output are not. */
const HOLD_SCALE = 1.5;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

// ---------------------------------------------------------------------------
// The DevTools protocol, over the WebSocket Node 22 ships with.

interface WsLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
}

class Cdp {
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(private readonly ws: WsLike) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id === undefined) return;
      const w = this.waiting.get(message.id);
      if (!w) return;
      this.waiting.delete(message.id);
      if (message.error) w.reject(new Error(message.error.message));
      else w.resolve(message.result);
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const Ctor = (globalThis as unknown as { WebSocket?: new (u: string) => WsLike }).WebSocket;
    if (!Ctor) throw new Error("this Node has no global WebSocket (22 or later is required)");
    const ws = new Ctor(url);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      ws.addEventListener("open", () => resolveOpen());
      ws.addEventListener("error", () => rejectOpen(new Error(`could not connect to ${url}`)));
    });
    return new Cdp(ws);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolveSend, rejectSend) => {
      this.waiting.set(id, { resolve: resolveSend as (v: unknown) => void, reject: rejectSend });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

// ---------------------------------------------------------------------------
// The stage: a page, a caption bar, and a timeline of held screenshots.

class Stage {
  scene = "";
  private caption = "";
  private shot = 0;

  constructor(
    private readonly cdp: Cdp,
    private readonly timeline: Timeline,
    private readonly dir: string,
  ) {}

  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.cdp.send<{ result?: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value as T;
  }

  setCaption(text: string): void {
    this.caption = text;
  }

  private async paintCaption(): Promise<void> {
    await this.eval(`(() => {
      const text = ${JSON.stringify(this.caption)};
      let el = document.getElementById("wt-caption");
      if (!text) { if (el) el.remove(); return; }
      if (!el) {
        el = document.createElement("div");
        el.id = "wt-caption";
        el.style.cssText = "position:fixed;left:0;right:0;bottom:0;padding:14px 28px;background:rgba(12,12,12,.93);color:#fff;font:21px/1.4 'Segoe UI',system-ui,sans-serif;z-index:2147483647;border-top:3px solid #4a9eff";
        document.body.appendChild(el);
      }
      el.textContent = text;
      document.body.style.paddingBottom = "120px";
    })()`);
  }

  /** Capture the page as it is and keep it on screen for `seconds` of video. */
  async snap(seconds: number): Promise<void> {
    await this.paintCaption();
    const { data } = await this.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    const file = join(this.dir, `f${String(this.shot++).padStart(5, "0")}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    this.timeline.add(file, seconds, this.scene);
  }

  async hold(seconds: number): Promise<void> {
    await this.snap(seconds * HOLD_SCALE);
  }

  async goto(url: string): Promise<void> {
    await this.cdp.send("Page.navigate", { url });
    await this.waitFor(`document.readyState === "complete" && location.href.startsWith(${JSON.stringify(url.split("?")[0])})`, { timeoutMs: 20_000, speed: 1, quiet: true });
  }

  /** Poll until the page expression is truthy, taking a frame a second, each held for 1/speed s. */
  async waitFor(condition: string, options: { timeoutMs: number; speed: number; quiet?: boolean }): Promise<void> {
    const started = Date.now();
    for (;;) {
      const ok = await this.eval<boolean>(`Boolean(${condition})`).catch(() => false);
      if (ok) return;
      if (Date.now() - started > options.timeoutMs) throw new Error(`timed out waiting for: ${condition}`);
      if (!options.quiet) await this.snap(1 / options.speed);
      await sleep(1000);
    }
  }

  /** Type into a field a few characters at a time, so the video shows it being typed. */
  async type(selector: string, text: string, charsPerFrame = 4, secondsPerFrame = 0.14): Promise<void> {
    await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.value = ""; })()`);
    for (let i = 0; i < text.length; i += charsPerFrame) {
      await this.cdp.send("Input.insertText", { text: text.slice(i, i + charsPerFrame) });
      await this.snap(secondsPerFrame);
    }
  }

  async scrollTo(y: number): Promise<void> {
    await this.eval(`window.scrollTo(0, ${y})`);
  }

  /** Replace the page with a document written from a string (a title card, a terminal). */
  async openHtml(html: string): Promise<void> {
    await this.cdp.send("Page.navigate", { url: "about:blank" });
    await this.waitFor(`document.readyState === "complete" && location.href === "about:blank"`, { timeoutMs: 5000, speed: 1, quiet: true });
    await this.eval(`(() => { document.open(); document.write(${JSON.stringify(html)}); document.close(); })()`);
  }

  /** A dark, monospaced page for a command's real output. */
  async openTerminal(title: string): Promise<void> {
    await this.openHtml(
      `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0c0c0c;color:#d8d8d8"><div style="padding:10px 22px;background:#1d1d1d;color:#8aa;font:15px Consolas,monospace">${title}</div><pre id="term" style="margin:0;padding:14px 22px 150px;font:14.5px/1.35 Consolas,monospace;white-space:pre-wrap"></pre></body>`,
    );
  }

  async terminalAppend(text: string): Promise<void> {
    await this.eval(`(() => { const t = document.getElementById("term"); t.textContent += ${JSON.stringify(text)}; window.scrollTo(0, document.body.scrollHeight); })()`);
  }

  /** Run a real command, show its real output as it arrives, and keep a frame per burst of output. */
  async runInTerminal(display: string, command: string, args: string[], env: NodeJS.ProcessEnv, speed: number): Promise<number> {
    await this.terminalAppend(`> ${display}\n`);
    await this.snap(1.2);
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let pending = "";
    const onData = (chunk: Buffer): void => {
      pending += chunk.toString("utf8").replace(ANSI, "");
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    let exitCode: number | null = null;
    child.on("close", (code) => {
      exitCode = code ?? 1;
    });
    while (exitCode === null || pending.length > 0) {
      if (pending.length > 0) {
        const text = pending;
        pending = "";
        await this.terminalAppend(text);
        await this.snap(0.6 / speed);
      } else {
        await sleep(250);
      }
    }
    await this.terminalAppend(`\n[exit code ${exitCode}]\n`);
    await this.snap(1);
    return exitCode ?? 1;
  }
}

// ---------------------------------------------------------------------------
// The private stack the recording runs against.

function spawnLogged(label: string, command: string, args: string[], env: NodeJS.ProcessEnv, logDir: string): ChildProcess {
  const log = createWriteStream(join(logDir, `${label}.log`));
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  return child;
}

async function startStack(logDir: string): Promise<ChildProcess[]> {
  for (const f of readdirSync("data")) if (f.startsWith("demo-")) rmSync(join("data", f), { force: true });
  const node = process.execPath;
  const flags = ["--no-warnings=ExperimentalWarning"];
  const children: ChildProcess[] = [];
  for (const [name, port] of Object.entries(GATEWAY_PORTS)) {
    children.push(spawnLogged(`${name}-gateway`, node, [...flags, `packages/${name}-gateway/dist/bin/gateway.js`, "--port", String(port), "--db", `data/demo-${name}.db`], {}, logDir));
  }
  const urls = Object.entries(GATEWAY_PORTS).map(([, port]) => `http://127.0.0.1:${port}`);
  await waitUp(urls, "the four gateways");
  children.push(
    spawnLogged("web", node, [...flags, "packages/web/dist/bin/web.js"], {
      WEB_PORT: String(WEB_PORT),
      HELPDESK_DB_PATH: "data/demo-identity.db",
      MDM_HELPDESK_DB_PATH: "data/demo-mdm.db",
      KNOWLEDGE_HELPDESK_DB_PATH: "data/demo-knowledge.db",
      ENDPOINT_HELPDESK_DB_PATH: "data/demo-endpoint.db",
      ORCHESTRATOR_DB_PATH: "data/demo-orchestrator.db",
      IDENTITY_GATEWAY_URL: urls[0]!,
      MDM_GATEWAY_URL: urls[1]!,
      KNOWLEDGE_GATEWAY_URL: urls[2]!,
      ENDPOINT_GATEWAY_URL: urls[3]!,
      HELPDESK_AGENT_AUTH: "session",
    }, logDir),
  );
  await waitUp([WEB], "the web app");
  return children;
}

async function waitUp(urls: string[], what: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if ((await unreachableGateways(urls)).length === 0) return;
    await sleep(1000);
  }
  throw new Error(`${what} did not come up`);
}

async function launchChrome(profileDir: string): Promise<{ chrome: ChildProcess; cdp: Cdp }> {
  const candidates = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].filter((p): p is string => Boolean(p));
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error("no Chrome or Edge found; set CHROME_PATH");
  const chrome = spawn(path, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`, "--window-size=1280,720", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let wsUrl: string | undefined;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(500);
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
  }
  if (!wsUrl) throw new Error("Chrome did not expose a page to drive");
  const cdp = await Cdp.connect(wsUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  return { chrome, cdp };
}

// ---------------------------------------------------------------------------
// The scenes.

const RESULT_READY = `document.querySelector(".ok, .info, .error") !== null && document.querySelector(".status") !== null`;

async function submitRequest(s: Stage, actor: string, text: string, speed: number): Promise<void> {
  await s.goto(`${WEB}/`);
  await s.hold(1.5);
  await s.type("#actor", actor, 8, 0.1);
  await s.type("#requestText", text, 4, 0.12);
  await s.hold(1.5);
  await s.eval(`document.querySelector("form").requestSubmit()`);
  await s.waitFor(RESULT_READY, { timeoutMs: 240_000, speed });
}

const card = (heading: string, lines: string[]): string =>
  `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;background:#101418;color:#e8edf2;font-family:'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box">` +
  `<div style="font-size:46px;font-weight:600;margin-bottom:26px">${heading}</div>` +
  lines.map((l) => `<div style="font-size:24px;line-height:1.5;color:#b7c2cc">${l}</div>`).join("") +
  `</body>`;

interface Ctx {
  logDir: string;
}

const SCENES: { name: string; title: string; run: (s: Stage, ctx: Ctx) => Promise<void> }[] = [
  {
    name: "title",
    title: "Title",
    run: async (s) => {
      await s.openHtml(
        card("scoped-agent-helpdesk", [
          "A helpdesk where agents each hold one narrow credential, and a human decides anything that changes something.",
          "&nbsp;",
          "Five minutes, no narration. Everything on screen is the running system, against a private copy of the stack.",
          "Captions say what is happening; speed-ups say how much.",
        ]),
      );
      await s.hold(8);
    },
  },
  {
    name: "resolves",
    title: "A request that resolves",
    run: async (s) => {
      s.setCaption("1 of 6 — A request that resolves. A how-to question: triage routes it, the knowledge agent searches the indexed Microsoft documentation and answers with its sources.");
      await submitRequest(s, REQUESTER_RESOLVES, "how do I enroll a Windows device in Intune?", 3);
      s.setCaption("Resolved. Triage chose the knowledge agent, a tool was called (a documentation search), and the reply cites where each fact came from. (The agent turn took tens of seconds and is shown at 3×.)");
      await s.hold(9);
      await s.scrollTo(380);
      await s.hold(7);
    },
  },
  {
    name: "gate",
    title: "The approval gate, with a briefing",
    run: async (s) => {
      s.setCaption("2 of 6 — A request that changes something. Adding a person to a group is never done by the agent alone.");
      await submitRequest(s, REQUESTER_GATE, "add marcoasensio@metehantestoutlook.onmicrosoft.com to the Marketing group", 3);
      s.setCaption("The agent looked the group up, asked for the change, and the policy engine routed it to approval. Nothing has been changed. (Shown at 3×.)");
      await s.hold(7);
      await s.goto(`${WEB}/console`);
      s.setCaption("The operator console. The change is a pending approval, waiting for a human, with its age.");
      await s.hold(6);
      await s.eval(`location.href = document.querySelector('a[href^="/console/approvals/"]').getAttribute("href")`);
      await s.waitFor(`location.pathname.startsWith("/console/approvals/") && document.readyState === "complete"`, { timeoutMs: 20_000, speed: 1, quiet: true });
      s.setCaption("Opened. The raw request, exactly as typed; what the system did and why, record by record across the chains; and what it could not do.");
      await s.hold(7);
      await s.scrollTo(560);
      s.setCaption("The trail is read from the audit chains by request id. Below it, the approver's actions.");
      await s.hold(6);
      await s.eval(`document.getElementById("rationale-request-form").scrollIntoView({block: "center"})`);
      await s.hold(2);
      await s.type("#requestedBy", OPERATOR, 6, 0.12);
      s.setCaption("The approver asks for a briefing on this exact change. It is generated only on request, by a model, and says so.");
      await s.hold(3);
      await s.eval(`document.getElementById("rationale-request-button").click()`);
      await s.hold(2);
      await s.waitFor(`document.querySelector(".rationale") !== null`, { timeoutMs: 90_000, speed: 2 });
      await s.eval(`document.querySelector(".rationale-label").scrollIntoView({block: "start"})`);
      s.setCaption("The briefing: what is being requested, what changes if approved, what is worth checking. Labelled supporting information, not a decision. Nothing is approved on camera.");
      await s.hold(14);
    },
  },
  {
    name: "refused",
    title: "Refused by a named rule",
    run: async (s) => {
      await s.openTerminal("endpoint gateway — reset_password, over a live MCP round trip");
      s.setCaption("3 of 6 — Refused by a named rule. A well-behaved model never asks for this, so the project proves it directly: a real token, a real round trip, the gateway's own answer.");
      await s.snap(4);
      const code = await s.runInTerminal("pnpm reset-password-smoke", process.execPath, ["--no-warnings=ExperimentalWarning", "packages/agent/dist/bin/reset-password-smoke.js"], { ENDPOINT_GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORTS.endpoint}` }, 1);
      if (code !== 0) throw new Error(`reset-password-smoke exited ${code}`);
      s.setCaption("Denied by deny.password_reset_never_automated: password reset is a class this system never performs, and the refusal is the policy engine's, recorded on the audit chain, not a model's good manners.");
      await s.hold(11);
    },
  },
  {
    name: "console",
    title: "The operator console working a handoff",
    run: async (s) => {
      s.setCaption("4 of 6 — Work nothing here can do becomes a handoff to a person, not a refusal. Two requests: hardware, then a security report.");
      await submitRequest(s, REQUESTER_HANDOFF, "My dock is broken, two monitors lose signal every time the laptop wakes.", 1);
      s.setCaption("A broken dock: triage says it needs a person. Handed off, with a handoff id.");
      await s.hold(5);
      await submitRequest(s, REQUESTER_HANDOFF, "I clicked a link in an email that looked like it came from our CFO and typed my Microsoft password into the page it opened.", 1);
      s.setCaption("A possible compromise: a security handoff, marked urgent.");
      await s.hold(5);
      await s.goto(`${WEB}/console`);
      await s.eval(`document.querySelector("h2:nth-of-type(2)").scrollIntoView({block: "start"})`);
      s.setCaption("The security report was submitted last and sits at the top of the queue, above the older dock request: urgent items sort first whatever their age.");
      await s.hold(9);
      await s.eval(`location.href = document.querySelector('a[href^="/console/handoffs/"]').getAttribute("href")`);
      await s.waitFor(`location.pathname.startsWith("/console/handoffs/") && document.readyState === "complete"`, { timeoutMs: 20_000, speed: 1, quiet: true });
      s.setCaption("Opened: the urgent flag, the raw request, what the system did, and why a person is needed.");
      await s.hold(7);
      await s.eval(`document.getElementById("takenBy").scrollIntoView({block: "center"})`);
      await s.type("#takenBy", OPERATOR, 6, 0.12);
      await s.hold(1.5);
      await s.eval(`document.querySelector("form button[type=submit]").click()`);
      await s.waitFor(`document.getElementById("resolvedBy") !== null`, { timeoutMs: 20_000, speed: 1, quiet: true });
      s.setCaption("Taken by the operator. Resolving needs a note: the one transition that must say what was done.");
      await s.eval(`document.getElementById("resolvedBy").scrollIntoView({block: "center"})`);
      await s.hold(2);
      await s.type("#resolvedBy", OPERATOR, 6, 0.12);
      await s.type("#note", "Reset the password and revoked the sessions, checked the sign-in log, told the user.", 5, 0.12);
      await s.hold(2);
      await s.eval(`document.querySelector("form button[type=submit]").click()`);
      await s.waitFor(`document.body.innerText.includes("Resolution note")`, { timeoutMs: 20_000, speed: 1, quiet: true });
      s.setCaption("Resolved, with the note on the record. Every step, the handoff, the taking and the resolving, is on the audit chain.");
      await s.hold(7);
      await s.goto(`${WEB}/console`);
      s.setCaption("Back in the queue: only the older dock request is left.");
      await s.hold(6);
    },
  },
  {
    name: "dashboard",
    title: "The dashboard",
    run: async (s) => {
      await s.goto(`${WEB}/dashboard`);
      s.setCaption("5 of 6 — The dashboard, read live from the five audit chains, every render. First: is the record itself trustworthy?");
      await s.hold(7);
      for (const [y, caption] of [
        [380, "How much the system handles, by day."],
        [760, "Did the system resolve things: the five outcomes, reject path and accept path kept apart, never blended into one number."],
        [1180, "How busy the humans are: what is waiting, for how long."],
        [1560, "What was stopped, by rule. And what it costs, by model."],
      ] as const) {
        await s.scrollTo(y);
        s.setCaption(caption);
        await s.hold(7);
      }
    },
  },
  {
    name: "isolation",
    title: "prove-isolation",
    run: async (s) => {
      await s.openTerminal("pnpm prove-isolation — twenty-two checks against the running gateways and Microsoft Entra");
      s.setCaption("6 of 6 — prove-isolation. Microsoft, not this codebase, keeps the four agents' credentials apart; and the gateways refuse a token meant for another gateway.");
      await s.snap(5);
      const code = await s.runInTerminal(
        "pnpm prove-isolation",
        process.execPath,
        ["--no-warnings=ExperimentalWarning", "packages/identity-gateway/dist/bin/prove-isolation.js"],
        {
          IDENTITY_GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORTS.identity}`,
          MDM_GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORTS.mdm}`,
          KNOWLEDGE_GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORTS.knowledge}`,
          ENDPOINT_GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORTS.endpoint}`,
        },
        1,
      );
      if (code !== 0) throw new Error(`prove-isolation exited ${code}`);
      s.setCaption("All twenty-two checks matched their expected outcome: eight refused by Entra itself, fourteen by the gateways' own token validation. It exits non-zero otherwise.");
      await s.hold(14);
    },
  },
  {
    name: "end",
    title: "End",
    run: async (s) => {
      s.setCaption("");
      await s.openHtml(
        card("Where to look next", [
          "README.md — the design, the evidence, and every finding that changed it.",
          "evidence/ — the runs this video summarises: isolation-run.txt, injection-run.md, the simulation passes.",
          "pnpm prove-isolation, pnpm prove-injection — the two checks that exit non-zero when a boundary does not hold.",
        ]),
      );
      await s.hold(8);
    },
  },
];

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { scenes: { type: "string" }, "keep-frames": { type: "boolean" } }, strict: true });
  const wanted = values.scenes ? new Set(values.scenes.split(",").map((s) => s.trim())) : null;
  for (const name of wanted ?? []) if (!SCENES.some((s) => s.name === name)) throw new Error(`no scene "${name}"; scenes are ${SCENES.map((s) => s.name).join(", ")}`);
  execFileSync(process.env.FFMPEG ?? "ffmpeg", ["-version"], { stdio: "ignore" });

  const work = mkdtempSync(join(tmpdir(), "walkthrough-"));
  const framesDir = join(work, "frames");
  mkdirSync(framesDir);
  mkdirSync(join(work, "logs"));
  const timeline = new Timeline();
  let children: ChildProcess[] = [];
  let chrome: ChildProcess | undefined;
  let cdp: Cdp | undefined;
  try {
    console.error("[walkthrough] starting the private stack");
    children = await startStack(join(work, "logs"));
    ({ chrome, cdp } = await launchChrome(join(work, "profile")));
    const stage = new Stage(cdp, timeline, framesDir);
    for (const scene of SCENES) {
      if (wanted && !wanted.has(scene.name)) continue;
      stage.scene = scene.title;
      stage.setCaption("");
      console.error(`[walkthrough] scene: ${scene.title}`);
      await scene.run(stage, { logDir: join(work, "logs") });
    }
  } finally {
    cdp?.close();
    chrome?.kill();
    for (const c of children) c.kill();
  }

  console.error(`[walkthrough] ${timeline.length} frames, ${mmss(timeline.totalSeconds())} of video; encoding`);
  const list = join(work, "frames.txt");
  writeFileSync(list, timeline.concatList(), "utf8");
  mkdirSync(resolve("evidence"), { recursive: true });
  execFileSync(process.env.FFMPEG ?? "ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-t", timeline.totalSeconds().toFixed(3), "-vf", "fps=10,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-movflags", "+faststart", OUT_VIDEO]);

  const spans = timeline.scenes();
  const notes = [
    "# Walkthrough",
    "",
    `[walkthrough.mp4](walkthrough.mp4), ${mmss(timeline.totalSeconds())}, silent, 1280×720, recorded ${new Date().toISOString()} by \`pnpm record-walkthrough\`.`,
    "",
    "| From | Length | Scene |",
    "|---|---|---|",
    ...spans.map((x) => `| ${mmss(x.startSeconds)} | ${mmss(x.seconds)} | ${x.scene} |`),
    "",
    "**What is real.** Every request goes through triage and a real agent against four gateways and the running web app, on a private copy of the stack (`data/demo-*.db`, ports 3031 to 3034 and 3100); every page is the app's own. The two terminal scenes run the built scripts behind `pnpm reset-password-smoke` and `pnpm prove-isolation` for real, against the private gateways, and show their real output (the pnpm wrapper only builds first).",
    "",
    "**What is shortened.** Agent turns take tens of seconds; the waits are sped up, and the caption says by how much. Typing is shown a few characters at a time.",
    "",
    "**What is chosen.** The refusal scene is not a chat message: a well-prompted model never asks for what the policy engine must refuse, so the project proves that refusal directly (see the README), and so does this video. Nothing is approved or rejected on camera.",
    "",
    "Regenerate it with `pnpm record-walkthrough` (needs Chrome, ffmpeg on the PATH and the live-tenant `.env`).",
    "",
  ];
  writeFileSync(OUT_NOTES, notes.join("\n"), "utf8");
  console.error(`[walkthrough] wrote ${OUT_VIDEO} and ${OUT_NOTES}`);
  if (!values["keep-frames"]) rmSync(work, { recursive: true, force: true });
  else console.error(`[walkthrough] frames kept in ${work}`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
