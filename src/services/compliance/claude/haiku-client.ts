import {
  HAIKU_MODEL_ID,
  ANTHROPIC_MESSAGES_ENDPOINT,
  ANTHROPIC_API_VERSION,
  ANTHROPIC_API_KEY_ENV_VAR,
  ClassifierVerdict,
} from '../../../types/compliance';
import {
  ClaudeClassifierClient,
  ClassifierRequest,
  MissingClaudeCredentialError,
  ClassifierTimeoutError,
  ClaudeClassifierError,
  VERDICT_JSON_SCHEMA,
} from './client';

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

export interface HaikuClientOptions {
  /** Env-var NAME the key is read from (never its value, §0.4). */
  apiKeyEnvVar?: string;
  /** Per-request timeout; a slow classifier escalates to a held state (§5.2/§5.4). */
  timeoutMs?: number;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: FetchLike;
  model?: string;
  endpoint?: string;
}

/**
 * Production classifier client (§4.4): the real Haiku 4.5 call path.
 *
 * Claude-only (§0.3): targets ONLY `claude-haiku-4-5-20251001` via the Anthropic
 * Messages API. If the API key is unset it throws `MissingClaudeCredentialError`
 * synchronously (no network, no fallback) so the engine fails CLOSED (§5.2).
 * There is deliberately no code path here that returns an approved/clear verdict
 * on error.
 */
export class HaikuClassifierClient implements ClaudeClassifierClient {
  private readonly apiKeyEnvVar: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: FetchLike;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(opts: HaikuClientOptions = {}) {
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? ANTHROPIC_API_KEY_ENV_VAR;
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.fetchImpl = opts.fetchImpl;
    this.model = opts.model ?? HAIKU_MODEL_ID;
    this.endpoint = opts.endpoint ?? ANTHROPIC_MESSAGES_ENDPOINT;
  }

  async classify(req: ClassifierRequest): Promise<ClassifierVerdict> {
    // Missing credential → fail CLOSED. No network attempt, no fallback (§0.3, §5.2).
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new MissingClaudeCredentialError(this.apiKeyEnvVar);
    }

    const fetchFn: FetchLike | undefined =
      this.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) {
      // No transport available — treat as unavailable, fail closed.
      throw new ClaudeClassifierError('No fetch implementation available for Haiku client.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = {
      model: this.model, // claude-haiku-4-5-20251001 (§4.4) — Claude-only
      max_tokens: 256,
      // Haiku 4.5 does not accept `thinking`/`effort`; classification needs neither.
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.content }],
      output_config: { format: { type: 'json_schema', schema: VERDICT_JSON_SCHEMA } },
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
        throw new ClaudeClassifierError(
          `Haiku classifier request failed with status ${res.status}.`
        );
      }
      raw = await res.text();
    } catch (err) {
      const errName = err instanceof Error ? err.name : undefined;
      if (errName === 'AbortError') {
        throw new ClassifierTimeoutError(req.classifier, this.timeoutMs);
      }
      if (err instanceof ClaudeClassifierError) throw err;
      throw new ClaudeClassifierError(
        `Haiku classifier transport error: ${errName ?? 'unknown'}`
      );
    } finally {
      clearTimeout(timer);
    }

    return this.parse(raw);
  }

  private parse(raw: string): ClassifierVerdict {
    let json: MessagesResponseBody;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ClaudeClassifierError('Haiku response was not valid JSON.');
    }

    // Extract the structured JSON payload from the Messages API content blocks.
    let payload: MessagesResponseBody = json;
    if (Array.isArray(json?.content)) {
      const textBlock = json.content.find(
        (b): b is { type: string; text: string } => !!b && b.type === 'text' && typeof b.text === 'string'
      );
      if (!textBlock) {
        throw new ClaudeClassifierError('Haiku response contained no text block.');
      }
      try {
        payload = JSON.parse(textBlock.text);
      } catch {
        throw new ClaudeClassifierError('Haiku verdict block was not valid JSON.');
      }
    }

    // A degenerate JSON body (e.g. the literal `"null"`) or a text block whose JSON parses to
    // `null` reaches here as `payload === null` — guard before any field read so that case throws
    // the SAME domain error as a payload merely missing the fields, never a raw TypeError.
    if (payload === null || typeof payload !== 'object') {
      throw new ClaudeClassifierError('Haiku verdict missing required fields.');
    }

    const flagged = payload.flagged;
    const confidence = payload.confidence;
    if (typeof flagged !== 'boolean' || typeof confidence !== 'number') {
      throw new ClaudeClassifierError('Haiku verdict missing required fields.');
    }

    // §5.2 fail-closed hardening: a confidence outside the [0,1] contract (NaN,
    // ±Infinity, negative, or >1) is an out-of-contract verdict — throw so the
    // engine HOLDS the item CLOSED rather than silently clamping a fabricated
    // value to 0/1 and acting on it.
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new ClaudeClassifierError(
        'Haiku verdict confidence out of contract range [0,1].'
      );
    }

    const rationale = payload.rationale;
    return {
      flagged,
      confidence,
      rationale: typeof rationale === 'string' ? rationale : undefined,
    };
  }
}
