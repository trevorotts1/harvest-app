// WP01 §6.4 — Agnes (`agnes-2.0-flash`) Seven Whys conversation client.
//
// T-R55b: wired as the DEFAULT production implementation of `SevenWhysConversationClient` per
// OPERATOR DIRECTIVE (2026-07-27): "Use my Agnes AI API key for anything where Anthropic was used
// previously" (see T-R55's `AgnesRuntimeClient`, src/services/agent-runtime/agnes/, and the CFE's
// `AgnesClassifierClient`, src/services/compliance/agnes/ — this client mirrors both byte-for-byte
// in structure). `SonnetConversationClient` (./claude-client.ts) is RETAINED, UNUSED, so its unit
// tests and the option to revert remain intact.
//
// §0.3 AMENDED (operator directive, see harvest-changelog.md's T-R55 entry): the prior "Claude-only"
// doctrine for this conversational-coaching path is retired. Agnes is now the DEFAULT provider. The
// FAIL-CLOSED property is provider-independent and UNCHANGED: a missing key / non-OK response /
// timeout / unparseable body all THROW — reusing the SAME `SevenWhysConversationError` /
// `SevenWhysTimeoutError` / `MissingClaudeCredentialError` classes the engine already expects — there
// is deliberately no code path here that returns a fabricated question/acknowledgment/anchor on
// error, and no fallback to any other provider.
//
// Agnes is OpenAI-compatible chat/completions, not the Anthropic Messages API — it does not accept an
// arbitrary `json_schema`; the exact required JSON shape is instead embedded as a textual contract at
// the end of each system prompt and requested via `response_format: { type: 'json_object' }` (mirrors
// `AgnesClassifierClient` / `eval/agnes-compliance-harness`).

import {
  AGNES_API_KEY_ENV_VAR,
  AGNES_ENDPOINT,
  AGNES_MODEL_ID,
} from '../../../../types/compliance';
import { MissingClaudeCredentialError } from '../../../compliance/claude';
import {
  SevenWhysAnchorRequest,
  SevenWhysAnchorResult,
  SevenWhysConverseRequest,
  SevenWhysConverseResult,
  clampUnit,
} from './types';
import {
  SevenWhysConversationClient,
  SevenWhysConversationError,
  SevenWhysTimeoutError,
} from './claude-client';

export { MissingClaudeCredentialError };

type FetchLike = (url: string, init: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/** Loosely-typed Agnes (OpenAI-compatible) chat-completions response body — fields validated with
 *  `typeof` narrowing at each read site, never trusted structurally (same discipline as
 *  `SonnetConversationClient`'s `MessagesResponseBody`). */
interface AgnesChatCompletionsResponseBody {
  choices?: Array<{ message?: { content?: string } }>;
  [key: string]: unknown;
}

export interface AgnesConversationClientOptions {
  /** Env-var NAME the key is read from (never its value, §0.4). */
  apiKeyEnvVar?: string;
  timeoutMs?: number;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: FetchLike;
  model?: string;
  endpoint?: string;
  /** Enable Agnes's `chat_template_kwargs.enable_thinking`; a first-attempt rejection of that field
   *  falls back to a single retry without it (mirrors `AgnesRuntimeClient`/`AgnesClassifierClient`
   *  exactly). Defaults to true. */
  enableThinking?: boolean;
}

// Same conversational contract as SonnetConversationClient's SYSTEM_PROMPT, plus the textual JSON
// contract Agnes needs in place of Anthropic's `output_config.format.json_schema`.
const TURN_JSON_CONTRACT =
  'Respond ONLY with a JSON object, no markdown fences: {"acknowledgment": string|null, ' +
  '"question": string, "depth_signal": number}. `depth_signal` is your PRIVATE 0.0-1.0 assessment ' +
  "of how emotionally resonant and specific the rep's answer was — never mention this number, or any " +
  'score/rating, inside `acknowledgment` or `question`.';

const SYSTEM_PROMPT = `You are The Harvest's Seven Whys guide — a warm, curious conversational coach helping a rep
discover the deep motivation beneath their stated goal, across seven levels in this exact order:
Goal, Urgency, History, Challenge, Fear, Transformation, Commitment.

Rules:
- Ask exactly ONE question per turn. Never list multiple questions, never preview a later level.
- Before the next question, offer a brief, warm, specific acknowledgment of what the rep just shared
  (omit this only on the very first turn, when there is nothing yet to acknowledge).
- Each question should build on what the rep just said — go deeper, don't just move to a generic next
  topic (progressive "why" laddering).
- Never mention a score, a rating, a resonance number, or any pass/fail judgment to the rep, under any
  circumstance. When a deeper prompt is warranted, frame it as care and curiosity ("Can you say more
  about ...", "Let's stay here a little longer") — never as a correction or a failed check.
- Never use: prospect, lead, pitch, sales call, guaranteed income, funnel, conversion, recruit (as
  extraction), cold outreach, target audience, follower. This is a personal, reflective conversation,
  not a sales script.
- Privately assess how emotionally resonant and specific the rep's answer was as depth_signal
  (0.0–1.0). This number is for internal scoring ONLY — it must never appear in your visible question
  or acknowledgment text.

${TURN_JSON_CONTRACT}`;

const ANCHOR_JSON_CONTRACT =
  'Respond ONLY with a JSON object, no markdown fences: {"anchor_statement": string}.';

const ANCHOR_SYSTEM_PROMPT = `You compose a single anchor statement from a completed Seven Whys conversation (Goal, Urgency,
History, Challenge, Fear, Transformation, Commitment). Write one short, first-person, present-tense
sentence or two that captures why this rep is building — grounded only in what they actually said,
never fabricated or generic. Never use: prospect, lead, pitch, sales call, guaranteed income, funnel,
conversion, recruit (as extraction), cold outreach, target audience, follower. Never mention a score
or rating.

${ANCHOR_JSON_CONTRACT}`;

/**
 * Production conversation client (§4.4, T-R55b): the real Agnes `agnes-2.0-flash` call path — the
 * operator-directed DEFAULT for this workload. If the API key is unset it throws
 * `MissingClaudeCredentialError` synchronously (no network, no fallback) — there is deliberately no
 * code path here that returns a fabricated question/acknowledgment on error.
 */
export class AgnesConversationClient implements SevenWhysConversationClient {
  private readonly apiKeyEnvVar: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: FetchLike;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly enableThinking: boolean;

  constructor(opts: AgnesConversationClientOptions = {}) {
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? AGNES_API_KEY_ENV_VAR;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl;
    this.model = opts.model ?? AGNES_MODEL_ID;
    this.endpoint = opts.endpoint ?? AGNES_ENDPOINT;
    this.enableThinking = opts.enableThinking ?? true;
  }

  async converse(req: SevenWhysConverseRequest): Promise<SevenWhysConverseResult> {
    const userContent = JSON.stringify({
      responding_to_level: req.respondingToLevel,
      answer: req.answer,
      next_level: req.nextLevel,
      is_deepening: req.isDeepening,
      transcript: req.transcript,
    });

    const raw = await this.call(SYSTEM_PROMPT, userContent);
    const payload = this.parseJsonBlock(raw);

    // `payload` is `null` for a degenerate JSON body (e.g. the literal `"null"`) or a text block
    // whose JSON parses to `null` — `?.` here reproduces base behavior (throw the SAME domain error
    // as a payload merely missing the fields) instead of a raw TypeError.
    const question = payload?.question;
    const depthSignal = payload?.depth_signal;
    if (typeof question !== 'string' || typeof depthSignal !== 'number') {
      throw new SevenWhysConversationError('Agnes conversation turn missing required fields.');
    }
    const acknowledgment = payload?.acknowledgment;
    return {
      acknowledgment: typeof acknowledgment === 'string' ? acknowledgment : null,
      question,
      depthSignal: clampUnit(depthSignal),
    };
  }

  async composeAnchor(req: SevenWhysAnchorRequest): Promise<SevenWhysAnchorResult> {
    const userContent = JSON.stringify({ transcript: req.transcript });
    const raw = await this.call(ANCHOR_SYSTEM_PROMPT, userContent);
    const payload = this.parseJsonBlock(raw);
    // See the matching comment in converse(): `payload` may be `null` for a degenerate JSON body.
    const anchorStatement = payload?.anchor_statement;
    if (typeof anchorStatement !== 'string' || anchorStatement.length === 0) {
      throw new SevenWhysConversationError('Agnes anchor composition returned no statement.');
    }
    return { anchorStatement };
  }

  private buildBody(system: string, userContent: string, withThinking: boolean) {
    return {
      model: this.model, // agnes-2.0-flash — the only model id this client ever sends
      max_tokens: 1024, // matches SonnetConversationClient's bounded, per-turn cost discipline
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      ...(withThinking ? { chat_template_kwargs: { enable_thinking: true } } : {}),
    };
  }

  private async call(system: string, userContent: string): Promise<string> {
    // Missing credential → throw. No network attempt, no fallback.
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new MissingClaudeCredentialError(this.apiKeyEnvVar);
    }

    const fetchFn: FetchLike | undefined = this.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) {
      throw new SevenWhysConversationError('No fetch implementation available for Agnes client.');
    }

    let raw: string;
    try {
      raw = await this.attempt(fetchFn, apiKey, system, userContent, this.enableThinking);
    } catch (err) {
      if (err instanceof SevenWhysTimeoutError || err instanceof SevenWhysConversationError) throw err;
      // One fallback retry with the optional "thinking" kwargs dropped, in case that specific field
      // is what the API rejected — mirrors `AgnesRuntimeClient`/`AgnesClassifierClient` exactly.
      if (this.enableThinking) {
        raw = await this.attempt(fetchFn, apiKey, system, userContent, false);
      } else {
        throw err;
      }
    }
    return raw;
  }

  private async attempt(
    fetchFn: FetchLike,
    apiKey: string,
    system: string,
    userContent: string,
    withThinking: boolean
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(this.buildBody(system, userContent, withThinking)),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new SevenWhysConversationError(
          `Agnes conversation request failed with status ${res.status}: ${text.slice(0, 300)}`
        );
      }
      return text;
    } catch (err) {
      const errName = err instanceof Error ? err.name : undefined;
      if (errName === 'AbortError') {
        throw new SevenWhysTimeoutError(this.timeoutMs);
      }
      if (err instanceof SevenWhysConversationError) throw err;
      throw new SevenWhysConversationError(
        `Agnes conversation transport error: ${errName ?? 'unknown'}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private parseJsonBlock(raw: string): Record<string, unknown> | null {
    let json: AgnesChatCompletionsResponseBody;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new SevenWhysConversationError('Agnes response was not valid JSON.');
    }

    if (json === null || typeof json !== 'object') {
      throw new SevenWhysConversationError('Agnes response body was not a JSON object.');
    }

    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new SevenWhysConversationError('Agnes response contained no message content.');
    }

    let text = content.trim();
    // Best-effort: strip a markdown fence if the model ignored the "no markdown fences" instruction.
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) text = fenceMatch[1].trim();

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (!braceMatch) {
        throw new SevenWhysConversationError('Agnes reply was not JSON and contained no JSON object.');
      }
      try {
        payload = JSON.parse(braceMatch[0]);
      } catch {
        throw new SevenWhysConversationError('Agnes reply JSON block was not valid JSON.');
      }
    }

    // `payload` may legitimately be `null` (e.g. the literal `"null"`) — callers read fields via
    // `?.` rather than assume an object is always present (same discipline as
    // `SonnetConversationClient.parseJsonBlock`).
    if (payload === null) return null;
    if (typeof payload !== 'object') {
      throw new SevenWhysConversationError('Agnes reply JSON block was not an object.');
    }
    return payload as Record<string, unknown>;
  }
}
