// WP01 §6.4 — the Seven Whys conversation client abstraction.
//
// Mirrors the DI-mockable Claude-client pattern the CFE already uses (src/services/compliance/
// claude/*, T-08): an interface the engine depends on, a real production implementation that calls
// the Anthropic Messages API, and a deterministic local implementation for tests/dev that needs no
// live ANTHROPIC_API_KEY. This file does not modify anything under src/services/compliance — it
// CONSUMES that module's public, already-exported wiring constants and its missing-credential error
// class (both read-only reuse, not internals) so there is exactly one definition of "what the
// Anthropic endpoint/version/env-var-name are" and "what a missing-key failure looks like" across the
// whole app, rather than a second drifting copy.
//
// Claude-only (§0.3): the ONLY implementations of `SevenWhysConversationClient` target Sonnet 5
// (§4.4 "Seven Whys conversational coaching") or a deterministic local heuristic for dev/test. A
// missing credential throws — it never falls back to a non-Claude provider and never silently
// degrades to a different model tier for this quality/doctrine-sensitive workload.

import {
  ANTHROPIC_API_KEY_ENV_VAR,
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_ENDPOINT,
} from '../../../../types/compliance';
import { MissingClaudeCredentialError } from '../../../compliance/claude';
import {
  SEVEN_WHYS_ANCHOR_JSON_SCHEMA,
  SEVEN_WHYS_MODEL_ID,
  SEVEN_WHYS_TURN_JSON_SCHEMA,
  SevenWhysAnchorRequest,
  SevenWhysAnchorResult,
  SevenWhysConverseRequest,
  SevenWhysConverseResult,
  clampUnit,
} from './types';

export { MissingClaudeCredentialError };

export class SevenWhysConversationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SevenWhysConversationError';
  }
}

export class SevenWhysTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Seven Whys conversation call timed out after ${timeoutMs}ms.`);
    this.name = 'SevenWhysTimeoutError';
  }
}

/**
 * The engine's dependency-injected boundary. One real call path (Sonnet 5) + one deterministic
 * local path (LocalSevenWhysConversationClient, see ./local-conversation-client.ts) implement this.
 */
export interface SevenWhysConversationClient {
  /** One question per turn (§6.4) — this is the ONLY method that produces rep-visible question text. */
  converse(req: SevenWhysConverseRequest): Promise<SevenWhysConverseResult>;
  /** Composes the anchor statement once the >70 completion gate has passed (§6.4 build item 3). */
  composeAnchor(req: SevenWhysAnchorRequest): Promise<SevenWhysAnchorResult>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/** Loosely-typed Anthropic Messages API response body — fields are validated with `typeof`
 *  narrowing at each read site rather than trusted structurally. */
interface MessagesResponseBody {
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
}

export interface SonnetConversationClientOptions {
  /** Env-var NAME the key is read from (never its value, §0.4). */
  apiKeyEnvVar?: string;
  timeoutMs?: number;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: FetchLike;
  model?: string;
  endpoint?: string;
}

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
  or acknowledgment text.`;

const ANCHOR_SYSTEM_PROMPT = `You compose a single anchor statement from a completed Seven Whys conversation (Goal, Urgency,
History, Challenge, Fear, Transformation, Commitment). Write one short, first-person, present-tense
sentence or two that captures why this rep is building — grounded only in what they actually said,
never fabricated or generic. Never use: prospect, lead, pitch, sales call, guaranteed income, funnel,
conversion, recruit (as extraction), cold outreach, target audience, follower. Never mention a score
or rating.`;

/**
 * Production conversation client (§4.4): the real Sonnet 5 call path.
 *
 * Claude-only (§0.3): targets ONLY `claude-sonnet-5`. If the API key is unset it throws
 * `MissingClaudeCredentialError` synchronously (no network, no fallback) — there is deliberately no
 * code path here that returns a fabricated question/acknowledgment on error.
 */
export class SonnetConversationClient implements SevenWhysConversationClient {
  private readonly apiKeyEnvVar: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: FetchLike;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(opts: SonnetConversationClientOptions = {}) {
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? ANTHROPIC_API_KEY_ENV_VAR;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl;
    this.model = opts.model ?? SEVEN_WHYS_MODEL_ID;
    this.endpoint = opts.endpoint ?? ANTHROPIC_MESSAGES_ENDPOINT;
  }

  async converse(req: SevenWhysConverseRequest): Promise<SevenWhysConverseResult> {
    const userContent = JSON.stringify({
      responding_to_level: req.respondingToLevel,
      answer: req.answer,
      next_level: req.nextLevel,
      is_deepening: req.isDeepening,
      transcript: req.transcript,
    });

    const raw = await this.call(SYSTEM_PROMPT, userContent, SEVEN_WHYS_TURN_JSON_SCHEMA);
    const payload = this.parseJsonBlock(raw);

    const question = payload.question;
    const depthSignal = payload.depth_signal;
    if (typeof question !== 'string' || typeof depthSignal !== 'number') {
      throw new SevenWhysConversationError('Sonnet conversation turn missing required fields.');
    }
    const acknowledgment = payload.acknowledgment;
    return {
      acknowledgment: typeof acknowledgment === 'string' ? acknowledgment : null,
      question,
      depthSignal: clampUnit(depthSignal),
    };
  }

  async composeAnchor(req: SevenWhysAnchorRequest): Promise<SevenWhysAnchorResult> {
    const userContent = JSON.stringify({ transcript: req.transcript });
    const raw = await this.call(ANCHOR_SYSTEM_PROMPT, userContent, SEVEN_WHYS_ANCHOR_JSON_SCHEMA);
    const payload = this.parseJsonBlock(raw);
    const anchorStatement = payload.anchor_statement;
    if (typeof anchorStatement !== 'string' || anchorStatement.length === 0) {
      throw new SevenWhysConversationError('Sonnet anchor composition returned no statement.');
    }
    return { anchorStatement };
  }

  private async call(system: string, userContent: string, schema: unknown): Promise<string> {
    // Missing credential → throw. No network attempt, no fallback (§0.3).
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new MissingClaudeCredentialError(this.apiKeyEnvVar);
    }

    const fetchFn: FetchLike | undefined = this.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) {
      throw new SevenWhysConversationError('No fetch implementation available for Sonnet client.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = {
      model: this.model, // claude-sonnet-5 (§4.4) — Claude-only
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: userContent }],
      // Sonnet 5 defaults to adaptive thinking when `thinking` is omitted; `effort: 'medium'` keeps
      // this bounded, per-turn conversational task cost-disciplined (§4.4/§4.5) without needing the
      // full `high` default for a short reflective question.
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    };

    let raw: string;
    try {
      const res = await fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new SevenWhysConversationError(
          `Sonnet conversation request failed with status ${res.status}.`
        );
      }
      raw = await res.text();
    } catch (err) {
      const errName = err instanceof Error ? err.name : undefined;
      if (errName === 'AbortError') {
        throw new SevenWhysTimeoutError(this.timeoutMs);
      }
      if (err instanceof SevenWhysConversationError) throw err;
      throw new SevenWhysConversationError(
        `Sonnet conversation transport error: ${errName ?? 'unknown'}`
      );
    } finally {
      clearTimeout(timer);
    }
    return raw;
  }

  private parseJsonBlock(raw: string): MessagesResponseBody {
    let json: MessagesResponseBody;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new SevenWhysConversationError('Sonnet response was not valid JSON.');
    }
    if (Array.isArray(json?.content)) {
      const textBlock = json.content.find(
        (b): b is { type: string; text: string } => !!b && b.type === 'text' && typeof b.text === 'string'
      );
      if (!textBlock) {
        throw new SevenWhysConversationError('Sonnet response contained no text block.');
      }
      try {
        return JSON.parse(textBlock.text);
      } catch {
        throw new SevenWhysConversationError('Sonnet structured-output block was not valid JSON.');
      }
    }
    return json;
  }
}
