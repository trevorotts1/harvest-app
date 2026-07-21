// T-23 (§7.2 segmentation; §4.4 "contact segmentation & relationship-type inference" → Haiku 4.5).
//
// Production classifier client: the real Haiku 4.5 call path. Mirrors
// src/services/compliance/claude/haiku-client.ts (T-08) and src/services/onboarding/wp01/
// seven-whys/claude-client.ts's `SonnetConversationClient` (WP01) byte-for-byte in structure — this
// file CONSUMES those modules' public, already-exported wiring constants and missing-credential
// error class (read-only reuse, not internals) so there is exactly one definition of "what the
// Anthropic endpoint/version/env-var-name are" and "what a missing-key failure looks like" across
// the app, rather than a third drifting copy.
//
// Claude-only (§0.3): targets ONLY `claude-haiku-4-5-20251001`. If the API key is unset it throws
// `MissingClaudeCredentialError` synchronously (no network, no fallback) — there is deliberately no
// code path here that returns a fabricated relationship type on error.

import {
  ANTHROPIC_API_KEY_ENV_VAR,
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_ENDPOINT,
  HAIKU_MODEL_ID,
} from '../../../types/compliance';
import { RelationshipType } from '../../../types/warm-market';
import { MissingClaudeCredentialError } from '../../compliance/claude';
import {
  RELATIONSHIP_TYPE_JSON_SCHEMA,
  SegmentationClient,
  SegmentationError,
  SegmentationRequest,
  SegmentationResult,
  SegmentationTimeoutError,
} from './client';

export { MissingClaudeCredentialError };

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

export interface HaikuSegmentationClientOptions {
  /** Env-var NAME the key is read from (never its value, §0.4). */
  apiKeyEnvVar?: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: FetchLike;
  model?: string;
  endpoint?: string;
}

const SYSTEM_PROMPT = `You infer the relationship type between a network-marketing rep and one of their warm-market
contacts, from whatever hints are available (free-text notes, industry/company, group membership).
Choose exactly one of: FAMILY, FRIEND, WORK, CHURCH, NEIGHBOR, COACH, FORMER_COLLEAGUE, OTHER.

Base your answer only on the hints actually given — never invent details that are not present. If
the hints are ambiguous or too thin to support a confident choice, choose OTHER and reflect that
with a lower confidence score rather than guessing.

Never use the words prospect, lead, pitch, sales call, guaranteed income, funnel, conversion, recruit
(as an extraction verb), cold outreach, target audience, or follower anywhere in your rationale —
this is a relationship classification for a personal contact list, not a sales judgment.`;

/**
 * Production segmentation client (§4.4): the real Haiku 4.5 call path.
 */
export class HaikuSegmentationClient implements SegmentationClient {
  private readonly apiKeyEnvVar: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: FetchLike;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(opts: HaikuSegmentationClientOptions = {}) {
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? ANTHROPIC_API_KEY_ENV_VAR;
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.fetchImpl = opts.fetchImpl;
    this.model = opts.model ?? HAIKU_MODEL_ID;
    this.endpoint = opts.endpoint ?? ANTHROPIC_MESSAGES_ENDPOINT;
  }

  async inferRelationshipType(req: SegmentationRequest): Promise<SegmentationResult> {
    // Missing credential → fail CLOSED. No network attempt, no fallback (§0.3).
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new MissingClaudeCredentialError(this.apiKeyEnvVar);
    }

    const fetchFn: FetchLike | undefined = this.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) {
      // No transport available — treat as unavailable, fail closed. Never silently degrade to a
      // non-Claude provider or a fabricated default.
      throw new SegmentationError('No fetch implementation available for the Haiku segmentation client.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = {
      model: this.model, // claude-haiku-4-5-20251001 (§4.4) — Claude-only
      max_tokens: 256,
      // Haiku 4.5 does not accept `thinking`/`effort`; a single-label classification needs neither.
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(req.hints) }],
      output_config: { format: { type: 'json_schema', schema: RELATIONSHIP_TYPE_JSON_SCHEMA } },
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
        throw new SegmentationError(`Haiku segmentation request failed with status ${res.status}.`);
      }
      raw = await res.text();
    } catch (err) {
      const errName = err instanceof Error ? err.name : undefined;
      if (errName === 'AbortError') {
        throw new SegmentationTimeoutError(this.timeoutMs);
      }
      if (err instanceof SegmentationError) throw err;
      throw new SegmentationError(`Haiku segmentation transport error: ${errName ?? 'unknown'}`);
    } finally {
      clearTimeout(timer);
    }

    return this.parse(raw);
  }

  private parse(raw: string): SegmentationResult {
    let json: MessagesResponseBody;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new SegmentationError('Haiku segmentation response was not valid JSON.');
    }

    // Extract the structured JSON payload from the Messages API content blocks.
    let payload: MessagesResponseBody = json;
    if (Array.isArray(json?.content)) {
      const textBlock = json.content.find(
        (b): b is { type: string; text: string } => !!b && b.type === 'text' && typeof b.text === 'string'
      );
      if (!textBlock) {
        throw new SegmentationError('Haiku segmentation response contained no text block.');
      }
      try {
        payload = JSON.parse(textBlock.text);
      } catch {
        throw new SegmentationError('Haiku segmentation JSON block was not valid JSON.');
      }
    }

    const relationshipType = payload.relationship_type;
    if (
      typeof relationshipType !== 'string' ||
      !(Object.values(RelationshipType) as string[]).includes(relationshipType)
    ) {
      throw new SegmentationError('Haiku segmentation verdict missing a valid relationship_type.');
    }
    const confidence = payload.confidence;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      throw new SegmentationError('Haiku segmentation verdict missing a valid confidence.');
    }

    const rationale = payload.rationale;
    return {
      relationshipType: relationshipType as RelationshipType,
      confidence: Math.max(0, Math.min(1, confidence)),
      rationale: typeof rationale === 'string' ? rationale : undefined,
    };
  }
}
