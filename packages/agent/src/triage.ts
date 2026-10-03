/**
 * Triage. SPRINT3.md, 3.1; split into two decisions by SPRINT4.md, section 1:
 *
 *   "Triage classifies a request and names which agent should handle it. That is its entire
 *    job... The output is a closed set, not free text... Nothing downstream trusts triage's
 *    judgement about permission, only about destination."
 *
 * One isolated Messages API call, the same shape as the approval rationale generator
 * (@helpdesk/identity-gateway's approvals/rationale.ts): no tools, no loop, no memory, a frozen
 * system prompt and the raw request text as the only user turn.
 *
 * SPRINT4.md, section 1: "Today triage picks one of five categories in a single step. Four of
 * the five are IT domains, so a request about a coffee machine finds a nearest match rather than
 * falling out." Decision one now asks a narrower question first — can this system do anything
 * about this at all — with five outcomes: `not_it` (not a corporate IT matter), `needs_human`
 * (genuinely IT, but needing hands, procurement, logistics, or something outside the tenant),
 * `network` (connectivity and infrastructure: someone with access to network equipment has to
 * look), `security` (a possible incident, handed off as urgent), or `routable`. The three that
 * hand off do so for different reasons, which is why they are three outcomes and not one.
 * Decision two, the four real agent categories, only fires for `routable`; there
 * is no fifth "unsupported" category to fall into any more, because that judgment now happens
 * one step earlier and explicitly, not by elimination.
 *
 * The output is a single JSON value naming the two decisions, plus one boolean, and nothing
 * else — no extracted parameters. That is deliberate, not an oversight: an unused field is a
 * field that gets used later, and the moment a downstream component reads something triage
 * pulled out of the request text, triage is inside the trust boundary the closed sets exist to
 * keep it outside of. See the README for the full reasoning. The raw request text is still
 * audited, under the same requestId, by the orchestration layer (orchestrator.ts) that calls
 * this file — never by triage itself — and the agent that actually gets invoked does its own
 * extraction through its own tools, from the same text. `notItTeam` keeps this discipline for
 * the `not_it` reply SPRINT4.md asks for ("names the team that would own it where that is
 * obvious"): a third closed set, not free text, so triage still never writes a sentence, only
 * picks from a fixed list the orchestrator turns into one.
 *
 * The `partiallyOutOfScope` boolean is not an exception to that either: it carries no data
 * anyone downstream could act on, only a flag that changes what the orchestrator tells the user
 * (SPRINT3.md, follow-up to 3.1's mixed-domain finding — a request mixing a supported and an
 * unsupported question used to pick one category and drop the rest silently). It says whether
 * part of the request falls outside whichever decision was made; it never says which agent
 * should handle that part, or what the part even is. Routing is unaffected either way.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/** Closed set, decision one. The router (orchestrator.ts) refuses anything outside it.
 *
 * `needs_human`, `network` and `security` are peers: each ends in a handoff to a person, none in a
 * refusal. They differ in the reason the handoff records and, for `security`, in its urgency
 * (orchestrator.ts). Splitting them out of one `needs_human` bucket is what lets a phishing report
 * be told apart from a broken dock, and a VPN fault from either. */
export const TRIAGE_SCOPES = ["not_it", "needs_human", "network", "security", "routable"] as const;
export type TriageScope = (typeof TRIAGE_SCOPES)[number];

/** Closed set, decision two — only meaningful, and only present, when scope is "routable". */
export const TRIAGE_CATEGORIES = ["identity", "mdm", "knowledge", "endpoint"] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

/** Closed set for "the reply names the team that would own it where that is obvious"
 * (SPRINT4.md, section 1) — the two cases the spec names explicitly. Null covers the common
 * case where nothing obvious applies (a personal device, a family member's issue, a delivery —
 * there is no team at the company that owns those at all). */
export const NOT_IT_TEAMS = ["facilities", "hr"] as const;
export type NotItTeam = (typeof NOT_IT_TEAMS)[number];

export const DEFAULT_TRIAGE_MODEL = "claude-haiku-4-5-20251001";

/** Four short field values as a handful of tokens of JSON — generous enough that a real reply
 * never truncates (the longest possible value, `{"outcome":"needs_human","agent":null,`
 * `"notItTeam":null,"partiallyOutOfScope":false}`, is under 20 tokens), tight enough that a
 * runaway reply still fails fast rather than running up cost. */
const MAX_OUTPUT_TOKENS = 64;

export const TRIAGE_SYSTEM_PROMPT = [
  "You classify one helpdesk request. That is your entire job. You do not answer the request,",
  "act on it, or extract anything from it beyond the fields below.",
  "",
  "First, decide what kind of matter this is and whether this system can act on it itself. Pick",
  "exactly one outcome:",
  "",
  '"not_it" - not a corporate IT matter at all: facilities (a broken appliance, a heating',
  "complaint), HR (a job referral, an expense claim, a leave policy question), a purely personal",
  "device or account with no connection to work, a family member's own issue, or a delivery or",
  "parcel question. Do not put a genuine IT question here just because it does not fit one of the",
  'categories below specifically — any workplace IT how-to question belongs under "route_to_agent"',
  'with the agent "knowledge" instead. A suspected phishing or scam message is never "not_it", even',
  'when it mentions a delivery, a supplier or a bank: that is "security".',
  '"needs_human" - genuinely an IT matter, but one that needs physical hands, procurement,',
  "shipping or logistics, or that lies outside this tenant entirely: a hardware fault, a broken or",
  "lost device that needs repair or replacing, a shipment, collection or loan of IT equipment,",
  "buying something, a vendor's own console or an account in another organisation's tenant, or an",
  "account tied to a former employer rather than this tenant. An application fault that no",
  "document could answer, and that needs a person to investigate, is also this. Things that are not",
  "this, even though they are often phrased as a problem rather than a request: a device reporting",
  'its own compliance, enrollment, or sync status ("not compliant", "needs attention", "pending',
  'evaluation", stuck checking status) is a state a registered device already carries — reading',
  'it takes no hands, so it belongs under "route_to_agent" with the agent "mdm" below, unless the',
  "request also says the device is physically broken, damaged, or needs replacing. A person's",
  'access, licence, account or sign-in being missing, denied, locked or blocked is an "identity"',
  'request described as a fault, not this. A fault in the network is "network", not this.',
  '"network" - connectivity and infrastructure: a VPN tunnel that will not establish or keeps',
  "dropping, DNS that does not resolve or resolves wrongly, Wi-Fi or wired LAN faults, DHCP and IP",
  "addressing, certificates, routing, latency or packet loss. A person with access to network",
  'equipment has to look at it. A how-to question about connecting ("how do I set up the VPN") is',
  'a documentation question, "knowledge", not this; so is whether the person is allowed to',
  'connect (an entitlement or a role), which is access, "identity".',
  '"security" - a possible security incident: a suspected phishing email or link, credentials',
  "entered on a page that may have been fake, authentication prompts or approvals the person did",
  "not ask for, a successful sign-in from a device or place they do not recognise, or a malware,",
  "ransomware or endpoint-protection detection alert. Pick this over every other outcome and",
  "agent whenever the request may describe an attack in progress or a compromise, even if it",
  "also mentions a delivery, a password or a device. It is handed to a person as urgent. A",
  "person's own sign-in being blocked, with nothing suspicious described, is not this.",
  '"route_to_agent" - this system has an agent with a tool that bears on the request. Continue to',
  "the agent choice below.",
  "",
  'Second, only when the outcome is "route_to_agent", pick exactly one agent, the one that best',
  "fits the request:",
  "",
  '"identity" - the request is about a person\'s directory account or what it can access: group',
  "membership and the shared resources a group controls (a mailbox, folder, drive, site, an",
  "application assignment); licence assignment, reassignment or removal; creating, enabling or",
  "disabling an account, including joiners and leavers; registering, replacing or resetting an MFA",
  "method; a sign-in that is blocked, including by conditional access, unless the block is caused",
  'by the state of one device (see "mdm" below); and an account that is locked out. Asking for any',
  'of these directly, or describing them as a fault ("I can\'t see the X folder anymore", "it asks',
  'me to request permission again", "my account keeps locking") belongs here just as much as',
  "\"please add me to X\", even though none of them ask for anything by name. This includes requests",
  "about directory roles or administrator access: classify those here too, even though they will",
  "be refused later, because they are identity requests, not something else. What matters is the",
  "domain, not whether an agent here can perform the change. A password reset itself is \"endpoint\"",
  "below, not this.",
  '"mdm" - the request asks about a device registered in the tenant: listing devices, asking about',
  "one device, or a message, error, or compliance/enrollment/sync status the device itself is",
  'showing ("not compliant", "needs attention", "pending evaluation", stuck checking status).',
  "Reading a device's own current state takes no hands, even when the requester describes it as",
  'something being wrong rather than a lookup — put it here, not "needs_human", unless the request',
  "itself says the device is physically broken, damaged, or needs replacing. A sign-in or access",
  "block that is caused by device state is also this, not identity, because the device record is",
  'the first thing to check: a block specific to one device, or naming its compliance or enrollment',
  '("device must be compliant", "device posture check failed", fine on the same account\'s other',
  "device). Hardware wording does not move a ticket out of this: a new, replacement or refurbished",
  "device, a serial number, or a firmware or recovery screen, in a ticket about compliance,",
  'enrollment or device status is still "mdm". Only a device that is physically broken, damaged or',
  'in need of replacing is "needs_human".',
  '"knowledge" - the request asks how something works, or asks a documentation or how-to',
  "question about anything IT supports at work — identity, devices, email, calendars, Teams,",
  "file sharing, printers, or any other everyday workplace IT topic — rather than asking to look",
  "anything up or change anything in this tenant. Classify a real IT how-to question here even",
  "if you are not sure the documentation actually covers that specific product: that is for the",
  "knowledge agent to say, not something to guess about in advance. An application that crashes,",
  "freezes, fails to install or misbehaves is a documentation question when a document could answer",
  "it (an error code, a known fix, a reset or reinstall procedure), even on a managed laptop; when",
  'no document could, it is "needs_human". Either way it is never "endpoint".',
  '"endpoint" - the request is about the device itself — the stub fleet of endpoints (devices,',
  "printers and similar equipment): listing them, checking one's status, or asking for a reboot.",
  "It is never about software running on a device: an application that crashes, freezes or fails to",
  "install is not an endpoint matter, even on a managed laptop. Also classify any",
  "password reset request here, for any user, even though this system never performs one: only",
  "the endpoint agent can tell the requester about self-service reset and their manager, so",
  '"not_it" or "needs_human" would silently swallow the request instead of giving them that',
  'answer. (A password reset after a suspected compromise is "security"; an account that is locked',
  'out is "identity".)',
  "",
  'When the outcome is "not_it", also decide which team, if any, obviously owns this instead. Set',
  'notItTeam to "facilities" or "hr" when one of those is clearly the right team, or to null when',
  "nothing obvious applies (a personal matter, a family member's issue, a delivery — there is no",
  "team at the company that owns those at all). Never guess at a team that is not clearly right.",
  'When the outcome is anything other than "not_it", notItTeam must be null.',
  "",
  "Finally, decide whether any part of the request falls outside the outcome (and agent, if any)",
  "you just picked — for example, a message that asks about group membership and also complains",
  "about a slow laptop. Set partiallyOutOfScope to true if so, even though you still only made",
  "one outcome decision. Set it to false when the whole request fits what you picked.",
  "",
  "Respond with exactly one line of JSON and nothing else, in this exact shape:",
  '{"outcome": "not_it" | "needs_human" | "network" | "security" | "route_to_agent",',
  ' "agent": "identity" | "mdm" | "knowledge" | "endpoint" | null,',
  ' "notItTeam": "facilities" | "hr" | null,',
  ' "partiallyOutOfScope": true | false}',
  'agent must be one of the four names, never null, when outcome is "route_to_agent", and must be',
  "null otherwise. No explanation, no markdown, no other text before or after it.",
].join("\n");

/** What the model is shown and what the code calls things, kept apart on purpose. The model's two
 * fields are `outcome` and `agent`; `TriageResult` (and every label file, the orchestrator and
 * the harness) still say `scope` and `category`. The old names were too easy to confuse: the value
 * `routable` names nothing, it only means "look in the other field", so a model that knew its answer
 * wrote `identity` or `mdm` into the first field. Every failure of that kind was a correct answer in the
 * wrong slot, and renaming alone removed it (0 of 58 against 6 of 58 on the tickets that failed). The
 * parser below is the only place the two vocabularies meet. */
export const TRIAGE_WIRE_OUTCOME = {
  not_it: "not_it",
  needs_human: "needs_human",
  network: "network",
  security: "security",
  routable: "route_to_agent",
} as const satisfies Record<TriageScope, string>;

const WIRE_OUTCOMES = ["not_it", "needs_human", "network", "security", "route_to_agent"] as const;

const outputSchema = z
  .object({
    outcome: z.enum(WIRE_OUTCOMES),
    agent: z.enum(TRIAGE_CATEGORIES).nullable(),
    notItTeam: z.enum(NOT_IT_TEAMS).nullable(),
    partiallyOutOfScope: z.boolean(),
  })
  .refine((v) => (v.outcome === "route_to_agent" ? v.agent !== null : v.agent === null), {
    message: "agent must be present iff outcome is route_to_agent",
    path: ["agent"],
  })
  .refine((v) => (v.outcome === "not_it" ? true : v.notItTeam === null), {
    message: "notItTeam must be null unless outcome is not_it",
    path: ["notItTeam"],
  });

interface TriageResultCommon {
  /** True when the classifier believes part of the request falls outside the scope (and
   * category, if any) it picked. Carries no data of its own — never a target, a parameter, or a
   * second category — so nothing downstream can act on it beyond changing what the user is told.
   * See the file header. */
  partiallyOutOfScope: boolean;
  /** The model that produced it, as reported by the API. */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** A discriminated union on `scope`, not flat optional fields: `category` is only ever present
 * for `routable`, and TypeScript enforces that at every call site — a caller that has not yet
 * checked `scope` cannot read `category` at all, let alone read it as non-null by assertion. */
export type TriageResult = TriageResultCommon &
  (
    | { scope: "not_it"; category: null; notItTeam: NotItTeam | null }
    | { scope: "needs_human"; category: null; notItTeam: null }
    | { scope: "network"; category: null; notItTeam: null }
    | { scope: "security"; category: null; notItTeam: null }
    | { scope: "routable"; category: TriageCategory; notItTeam: null }
  );

export interface TriageClassifier {
  classify(requestText: string): Promise<TriageResult>;
}

export class TriageError extends Error {
  override readonly name = "TriageError";
  constructor(
    /** "api_error:<status>", "stop_reason:<reason>", "empty_response", "invalid_output", or "network". */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface TriageClassifierOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
  /** Milliseconds. This runs before any agent turn starts, so keep it short. */
  timeoutMs?: number;
}

export function createTriageClassifier(options: TriageClassifierOptions): TriageClassifier {
  if (!options.apiKey) throw new Error("ANTHROPIC_API_KEY is required to classify a request");

  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs ?? 30_000,
    maxRetries: 2,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const model = options.model ?? DEFAULT_TRIAGE_MODEL;

  return {
    async classify(requestText) {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: TRIAGE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: requestText }],
          // Explicit, not an omission: a model whose own default is extended thinking (confirmed
          // live against claude-sonnet-5, which otherwise spends the entire MAX_OUTPUT_TOKENS
          // budget on a thinking block and never reaches the JSON, failing stop_reason=max_tokens
          // on a majority of real requests) would silently defeat the budget comment above. This
          // one classification step was designed, per this file's own header, to need no loop, no
          // memory, and no reasoning beyond picking from a closed set — thinking is not a feature
          // this call wants from any model, pinned or overridden via HELPDESK_TRIAGE_MODEL.
          thinking: { type: "disabled" },
          // No output_config/effort: confirmed live against claude-haiku-4-5-20251001 that it
          // rejects the effort parameter outright (400, "This model does not support the effort
          // parameter"), unlike the rationale generator's claude-opus-5. A three-word
          // classification does not need tuning either way.
        });
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          throw new TriageError(`api_error:${error.status ?? "unknown"}`, `Triage request failed (${error.status}): ${error.message}`);
        }
        throw new TriageError("network", `Triage request failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (response.stop_reason !== "end_turn") {
        throw new TriageError(`stop_reason:${response.stop_reason}`, `Triage not completed: stop_reason=${response.stop_reason}`);
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (text.length === 0) throw new TriageError("empty_response", "Triage response contained no text");

      // The system prompt asks for no markdown, but confirmed live: claude-haiku-4-5-20251001
      // sometimes wraps otherwise-correct JSON in a ```json fence anyway. Stripping a fence is a
      // formatting tolerance, not a validation relaxation — the schema check right below is
      // exactly as strict either way, and still rejects anything that doesn't name a category
      // in the closed set once unwrapped.
      const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
      const candidate = fenced ? fenced[1]! : text;

      let parsed: unknown;
      try {
        parsed = JSON.parse(candidate);
      } catch {
        throw new TriageError("invalid_output", `Triage response was not valid JSON: ${text}`);
      }
      const result = outputSchema.safeParse(parsed);
      if (!result.success) {
        throw new TriageError("invalid_output", `Triage response did not name a known outcome/agent: ${text}`);
      }

      const common = {
        partiallyOutOfScope: result.data.partiallyOutOfScope,
        model: response.model,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };

      // A switch on the validated outcome, not a type assertion: outputSchema's own .refine()
      // calls already checked agent/notItTeam's nullability against outcome at runtime, but a
      // zod object type does not carry that cross-field invariant into result.data's static
      // type. Re-establishing it here with a real discriminant check, rather than an `as` past
      // the compiler, means a future change to the schema that breaks the invariant fails to
      // compile instead of silently type-checking.
      switch (result.data.outcome) {
        case "not_it":
          return { ...common, scope: "not_it", category: null, notItTeam: result.data.notItTeam };
        case "needs_human":
          return { ...common, scope: "needs_human", category: null, notItTeam: null };
        case "network":
          return { ...common, scope: "network", category: null, notItTeam: null };
        case "security":
          return { ...common, scope: "security", category: null, notItTeam: null };
        case "route_to_agent": {
          // The one place the model's vocabulary becomes the code's: outcome "route_to_agent" is
          // scope "routable", and the model's `agent` is `category`. See TRIAGE_WIRE_OUTCOME.
          const { agent } = result.data;
          if (agent === null) throw new TriageError("invalid_output", `Triage response was route_to_agent with no agent: ${text}`);
          return { ...common, scope: "routable", category: agent, notItTeam: null };
        }
      }
    },
  };
}
