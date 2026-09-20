/**
 * Triage. SPRINT3.md, 3.1:
 *
 *   "Triage classifies a request and names which agent should handle it. That is its entire
 *    job... The output is a closed set, not free text... Nothing downstream trusts triage's
 *    judgement about permission, only about destination."
 *
 * One isolated Messages API call, the same shape as the approval rationale generator
 * (@helpdesk/identity-gateway's approvals/rationale.ts): no tools, no loop, no memory, a frozen
 * system prompt and the raw request text as the only user turn.
 *
 * The output is a single JSON value naming one of the categories, plus one boolean, and nothing
 * else — no extracted parameters. That is deliberate, not an oversight: an unused field is a
 * field that gets used later, and the moment a downstream component reads something triage
 * pulled out of the request text, triage is inside the trust boundary the closed category set
 * exists to keep it outside of. See the README for the full reasoning. The raw request text is
 * still audited, under the same requestId, by the orchestration layer (orchestrator.ts) that
 * calls this file — never by triage itself — and the agent that actually gets invoked does its
 * own extraction through its own tools, from the same text.
 *
 * The one boolean, `partiallyOutOfScope`, is not an exception to that: it carries no data anyone
 * downstream could act on, only a flag that changes what the orchestrator tells the user (SPRINT3.md,
 * follow-up to 3.1's mixed-domain finding — a request mixing a supported and an unsupported
 * question used to pick one category and drop the rest silently). It says whether part of the
 * request falls outside whichever category was chosen; it never says which agent should handle
 * that part, or what the part even is. Routing is unaffected either way.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/** Closed set. The router (orchestrator.ts) refuses anything outside it rather than guessing. */
export const TRIAGE_CATEGORIES = ["identity", "mdm", "knowledge", "endpoint", "unsupported"] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

export const DEFAULT_TRIAGE_MODEL = "claude-haiku-4-5-20251001";

/** A category name is a handful of tokens of JSON. Anything longer is already a malformed reply. */
const MAX_OUTPUT_TOKENS = 32;

export const TRIAGE_SYSTEM_PROMPT = [
  "You classify one helpdesk request. That is your entire job. You do not answer the request,",
  "act on it, or extract anything from it beyond the two fields below.",
  "",
  "First, pick exactly one category, the one that best fits the request:",
  "",
  '"identity" - the request asks about a user\'s group membership, or asks to add or remove a',
  "user from a group. This includes requests about directory roles or administrator access:",
  "classify those here too, even though they will be refused later, because they are identity",
  "requests, not something else.",
  '"mdm" - the request asks about devices registered in the tenant: listing them, or asking',
  "about one device.",
  '"knowledge" - the request asks how something works, or asks a documentation or how-to',
  "question about identity or device management, rather than asking to look anything up or",
  "change anything in this tenant.",
  '"endpoint" - the request is about the stub fleet of endpoints (devices, printers and similar',
  "equipment): listing them, checking one's status, or asking for a reboot. Also classify any",
  "password reset request here, for any user, even though this system never performs one: only",
  "the endpoint agent can tell the requester about self-service reset and their manager, so",
  '"unsupported" would silently swallow the request instead of giving them that answer.',
  '"unsupported" - anything else, unrelated to identity, device lookups, endpoints, password',
  "resets, or how-to documentation.",
  "",
  "Second, decide whether any part of the request falls outside the category you just picked —",
  "for example, a message that asks about group membership and also complains about a slow",
  "laptop. Set partiallyOutOfScope to true if so, even though you still only named one category.",
  "Set it to false when the whole request fits the category you picked.",
  "",
  "Respond with exactly one line of JSON and nothing else, in this exact shape:",
  '{"category": "identity" | "mdm" | "knowledge" | "endpoint" | "unsupported", "partiallyOutOfScope": true | false}',
  "No explanation, no markdown, no other text before or after it.",
].join("\n");

const outputSchema = z.object({ category: z.enum(TRIAGE_CATEGORIES), partiallyOutOfScope: z.boolean() });

export interface TriageResult {
  category: TriageCategory;
  /** True when the classifier believes part of the request falls outside `category`. Carries no
   * data of its own — never a target, a parameter, or a second category — so nothing downstream
   * can act on it beyond changing what the user is told. See the file header. */
  partiallyOutOfScope: boolean;
  /** The model that produced it, as reported by the API. */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

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
        throw new TriageError("invalid_output", `Triage response did not name a known category: ${text}`);
      }

      return {
        category: result.data.category,
        partiallyOutOfScope: result.data.partiallyOutOfScope,
        model: response.model,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },
  };
}
