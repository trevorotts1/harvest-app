// T-23 (§7.2 segmentation) / T-R55b — Agnes (`agnes-2.0-flash`) segmentation client.
//
// Wired as the DEFAULT production implementation of `SegmentationClient` per OPERATOR DIRECTIVE
// (2026-07-27): "Use my Agnes AI API key for anything where Anthropic was used previously" (see
// T-R55's `AgnesRuntimeClient`, src/services/agent-runtime/agnes/, and the CFE's
// `AgnesClassifierClient`, src/services/compliance/agnes/ — this client mirrors both byte-for-byte in
// structure). `HaikuSegmentationClient` (./haiku-client.ts) is RETAINED, UNUSED, so its unit tests and
// the option to revert remain intact.
//
// §0.3 AMENDED (operator directive, see harvest-changelog.md's T-R55 entry): the prior "Claude-only"
// doctrine for this classification path is retired. Agnes is now the DEFAULT provider. The
// FAIL-CLOSED property is provider-independent and UNCHANGED: a missing key / non-OK response /
// timeout / unparseable body all THROW — reusing the SAME `SegmentationError` /
// `SegmentationTimeoutError` / `MissingClaudeCredentialError` classes the engine already expects —
// there is deliberately no code path here that returns a fabricated relationship type on error.
//
// Agnes is OpenAI-compatible chat/completions, not the Anthropic Messages API — it does not accept an
// arbitrary `json_schema`; the exact required JSON shape is instead embedded as a textual contract at
// the end of the system prompt and requested via `response_format: { type: 'json_object' }` (mirrors
// `AgnesClassifierClient` / `eval/agnes-compliance-harness`).

import {
  AGNES_API_KEY_ENV_VAR,
  AGNES_ENDPOINT,
  AGNES_MODEL_ID,
} from '../../../types/compliance';
import { RelationshipType } from '../../../types/warm-market';
import { MissingClaudeCredentialError } from '../../compliance/claude';
import {
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

/** Loosely-typed Agnes (OpenAI-compatible) chat-completions response body — fields validated with
 *  `typeof` narrowing at each read site, never trusted structurally. */
interface AgnesChatCompletionsResponseBody {
  choices?: Array<{ message?: { content?: string } }>;
  [key: string]: unknown;
}

export interface AgnesSegmentationClientOptions {
  /** Env-var NAME the key is read from (never its value, §0.4). */
  apiKeyEnvVar?: string;
  /** Per-request timeout. */
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

const JSON_CONTRACT =
  'Respond ONLY with a JSON object, no markdown fences: {"relationship_type": string, ' +
  '"confidence": number, "rationale": string}. `relationship_type` MUST be exactly one of: ' +
  `${Object.values(RelationshipType).join(', ')}. \`confidence\` is your 0.0-1.0 assessment of how ` +
  'confident you are in that choice.';

const SYSTEM_PROMPT = `You infer the relationship type between a network-marketing rep and one of their warm-market
contacts, from whatever hints are available (free-text notes, industry/company, group membership).
Choose exactly one of: FAMILY, FRIEND, WORK, CHURCH, NEIGHBOR, COACH, FORMER_COLLEAGUE, OTHER.

Base your answer only on the hints actually given — never invent details that are not present. If
the hints are ambiguous or too thin to support a confident choice, choose OTHER and reflect that
with a lower confidence score rather than guessing.

Never use the words prospect, lead, pitch, sales call, guaranteed income, funnel, conversion, recruit
(as an extraction verb), cold outreach, target audience, or follower anywhere in your rationale —
this is a relationship classification for a personal contact list, not a sales judgment.

${JSON_CONTRACT}`;

/**
 * Production segmentation client (§4.4, T-R55b): the real Agnes `agnes-2.0-flash` call path — the
 * operator-directed DEFAULT for this workload.
 */
export class AgnesSegmentationClient implements SegmentationClient {
  private readonly apiKeyEnvVar: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: FetchLike;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly enableThinking: boolean;

  constructor(opts: AgnesSegmentationClientOptions = {}) {
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? AGNES_API_KEY_ENV_VAR;
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.fetchImpl = opts.fetchImpl;
    this.model = opts.model ?? AGNES_MODEL_ID;
    this.endpoint = opts.endpoint ?? AGNES_ENDPOINT;
    this.enableThinking = opts.enableThinking ?? true;
  }

  async inferRelationshipType(req: SegmentationRequest): Promise<SegmentationResult> {
    // Missing credential → fail CLOSED. No network attempt, no fallback.
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new MissingClaudeCredentialError(this.apiKeyEnvVar);
    }

    const fetchFn: FetchLike | undefined = this.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) {
      // No transport available — treat as unavailable, fail closed. Never silently degrade to a
      // different provider or a fabricated default.
      throw new SegmentationError('No fetch implementation available for the Agnes segmentation client.');
    }

    const userContent = JSON.stringify(req.hints);

    let raw: string;
    try {
      raw = await this.attempt(fetchFn, apiKey, userContent, this.enableThinking);
    } catch (err) {
      if (err instanceof SegmentationTimeoutError || err instanceof SegmentationError) throw err;
      // One fallback retry with the optional "thinking" kwargs dropped — mirrors
      // `AgnesRuntimeClient`/`AgnesClassifierClient` exactly.
      if (this.enableThinking) {
        raw = await this.attempt(fetchFn, apiKey, userContent, false);
      } else {
        throw err;
      }
    }

    return this.parse(raw);
  }

  private buildBody(userContent: string, withThinking: boolean) {
    return {
      model: this.model, // agnes-2.0-flash — the only model id this client ever sends
      max_tokens: 256,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      ...(withThinking ? { chat_template_kwargs: { enable_thinking: true } } : {}),
    };
  }

  private async attempt(
    fetchFn: FetchLike,
    apiKey: string,
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
        body: JSON.stringify(this.buildBody(userContent, withThinking)),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new SegmentationError(`Agnes segmentation request failed with status ${res.status}: ${text.slice(0, 300)}`);
      }
      return text;
    } catch (err) {
      const errName = err instanceof Error ? err.name : undefined;
      if (errName === 'AbortError') {
        throw new SegmentationTimeoutError(this.timeoutMs);
      }
      if (err instanceof SegmentationError) throw err;
      throw new SegmentationError(`Agnes segmentation transport error: ${errName ?? 'unknown'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private parse(raw: string): SegmentationResult {
    let json: AgnesChatCompletionsResponseBody;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new SegmentationError('Agnes segmentation response was not valid JSON.');
    }

    if (json === null || typeof json !== 'object') {
      throw new SegmentationError('Agnes segmentation verdict missing a valid relationship_type.');
    }

    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new SegmentationError('Agnes segmentation response contained no message content.');
    }

    let text = content.trim();
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) text = fenceMatch[1].trim();

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (!braceMatch) {
        throw new SegmentationError('Agnes segmentation reply was not JSON and contained no JSON object.');
      }
      try {
        payload = JSON.parse(braceMatch[0]);
      } catch {
        throw new SegmentationError('Agnes segmentation reply JSON block was not valid JSON.');
      }
    }

    // A degenerate JSON body (e.g. the literal `"null"`) reaches here as `payload === null` — guard
    // before any field read so that case throws the SAME domain error as a payload merely missing
    // the fields, never a raw TypeError.
    if (payload === null || typeof payload !== 'object') {
      throw new SegmentationError('Agnes segmentation verdict missing a valid relationship_type.');
    }

    const record = payload as Record<string, unknown>;
    const relationshipType = record.relationship_type;
    if (
      typeof relationshipType !== 'string' ||
      !(Object.values(RelationshipType) as string[]).includes(relationshipType)
    ) {
      throw new SegmentationError('Agnes segmentation verdict missing a valid relationship_type.');
    }
    const confidence = record.confidence;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      throw new SegmentationError('Agnes segmentation verdict missing a valid confidence.');
    }

    const rationale = record.rationale;
    return {
      relationshipType: relationshipType as RelationshipType,
      confidence: Math.max(0, Math.min(1, confidence)),
      rationale: typeof rationale === 'string' ? rationale : undefined,
    };
  }
}
