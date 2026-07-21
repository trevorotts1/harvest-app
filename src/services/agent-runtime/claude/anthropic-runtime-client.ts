// WP04 (T-30) — the REAL agent model client: the Anthropic Messages API call path (§4.3/§4.4).
//
// Claude-only, fail-closed (§0.3 ABSOLUTE / §4.6): targets ONLY the Anthropic API on a tier from
// `CLAUDE_MODEL_IDS` (all `claude-*`). If ANTHROPIC_API_KEY is unset it throws
// `MissingClaudeCredentialError` synchronously — no network attempt, no non-Claude fallback, and no
// fabricated/stubbed completion. There is deliberately no code path here that returns a completion
// on error, so the runtime that calls it can only ever HOLD (never send) when Claude is unreachable.
//
// Build-safety: the key is read LAZILY inside `generate` (via process.env by NAME only, §0.4) — never
// at module scope — so `next build` and the test suite pass with no key present.

import {
  ANTHROPIC_API_KEY_ENV_VAR,
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_ENDPOINT,
} from '@/types/compliance';
import { CLAUDE_MODEL_IDS, ClaudeModelTier, HARD_MAX_OUTPUT_TOKENS_PER_RUN } from '../runtime-model-map';
import {
  AgentGenerationRequest,
  AgentGenerationResult,
  AgentModelClient,
  AgentModelError,
  AgentModelTimeoutError,
  MissingClaudeCredentialError,
} from './runtime-client';

type FetchLike = (
  url: string,
  init: any
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface AnthropicRuntimeClientOptions {
  /** Env-var NAME the key is read from (never its value, §0.4). */
  apiKeyEnvVar?: string;
  /** Per-request timeout; a slow/hung call fails the run CLOSED. */
  timeoutMs?: number;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Endpoint override (test only). Always the Anthropic endpoint in production. */
  endpoint?: string;
  /** Tier → wire model id override (test only). Defaults to the §4.4 map (Claude-only). */
  modelIds?: Record<ClaudeModelTier, string>;
}

export class AnthropicRuntimeClient implements AgentModelClient {
  private readonly apiKeyEnvVar: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: FetchLike;
  private readonly endpoint: string;
  private readonly modelIds: Record<ClaudeModelTier, string>;

  constructor(opts: AnthropicRuntimeClientOptions = {}) {
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? ANTHROPIC_API_KEY_ENV_VAR;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.fetchImpl = opts.fetchImpl;
    this.endpoint = opts.endpoint ?? ANTHROPIC_MESSAGES_ENDPOINT;
    this.modelIds = opts.modelIds ?? CLAUDE_MODEL_IDS;
  }

  async generate(req: AgentGenerationRequest): Promise<AgentGenerationResult> {
    // Missing credential → fail CLOSED. No network, no fallback, no stub (§0.3, §4.6).
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new MissingClaudeCredentialError(this.apiKeyEnvVar);
    }

    const modelId = this.modelIds[req.tier];
    // Defensive: the only ids that can reach the wire are Claude ids from the §4.4 map.
    if (!modelId || !modelId.startsWith('claude-')) {
      throw new AgentModelError(`Refusing to call a non-Claude model id for tier '${req.tier}'.`);
    }

    const fetchFn: FetchLike | undefined = this.fetchImpl ?? (globalThis as any).fetch;
    if (!fetchFn) {
      throw new AgentModelError('No fetch implementation available for the Anthropic runtime client.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // T-R27 FIX (closes QC#1 reject): CLAMP, never just default — `req.maxTokens` is trusted for
    // anything UNDER the hard cap (a caller may legitimately want a smaller budget for a short step),
    // but is never allowed to request MORE than `HARD_MAX_OUTPUT_TOKENS_PER_RUN` on the wire, even if
    // some future caller passes a larger value. This is what makes the cost-killswitch's reservation
    // estimate (cost-killswitch/run-gate.ts) a TRUE worst-case bound rather than a hopeful default:
    // no real call through this client can EVER generate more output tokens than that reservation
    // priced for.
    const requestedMaxTokens = req.maxTokens ?? HARD_MAX_OUTPUT_TOKENS_PER_RUN;
    const body: Record<string, unknown> = {
      model: modelId, // a claude-* id from CLAUDE_MODEL_IDS — Claude-only (§0.3)
      max_tokens: Math.min(requestedMaxTokens, HARD_MAX_OUTPUT_TOKENS_PER_RUN),
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
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
        // A 429 surfaces as AgentModelError → the durable queue retries idempotently (§4.6).
        throw new AgentModelError(`Anthropic request failed with status ${res.status}.`);
      }
      raw = await res.text();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new AgentModelTimeoutError(this.timeoutMs);
      }
      if (err instanceof AgentModelError) throw err;
      throw new AgentModelError(`Anthropic transport error: ${err?.name ?? 'unknown'}`);
    } finally {
      clearTimeout(timer);
    }

    return this.parse(raw, req, modelId);
  }

  private parse(raw: string, req: AgentGenerationRequest, modelId: string): AgentGenerationResult {
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AgentModelError('Anthropic response was not valid JSON.');
    }

    let text = '';
    if (Array.isArray(json?.content)) {
      const textBlock = json.content.find(
        (b: any) => b && b.type === 'text' && typeof b.text === 'string'
      );
      if (!textBlock) {
        throw new AgentModelError('Anthropic response contained no text block.');
      }
      text = textBlock.text;
    } else if (typeof json?.text === 'string') {
      text = json.text;
    } else {
      throw new AgentModelError('Anthropic response had no usable text content.');
    }

    const usage = json?.usage ?? {};
    return {
      text,
      modelId,
      tier: req.tier,
      tokenInput: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
      tokenOutput: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0,
      batched: Boolean(req.batched),
    };
  }
}
