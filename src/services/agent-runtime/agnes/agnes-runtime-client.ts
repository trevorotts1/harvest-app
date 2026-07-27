// T-R55 — Agnes (`agnes-2.0-flash`) agent-generation client: the REAL model call path for the
// nine-agent suite (§4.2/§4.3), replacing the Anthropic Messages API path per OPERATOR DIRECTIVE
// (2026-07-27): "Use my Agnes AI API key for anything where Anthropic was used previously." Agnes is
// the operator's chosen, vetted provider (AGNES_AI_API_KEY; validated in eval/agnes-compliance-harness).
//
// PROVIDER-DOCTRINE (§0.3): the former "Claude-only" doctrine is superseded by this operator directive
// — Agnes is now the sole AI provider for generation. This client is a drop-in `AgentModelClient` and
// is wired as the DEFAULT in place of `AnthropicRuntimeClient` (which is retained, unused, so its unit
// tests and the option to revert remain intact). The SAFETY property is UNCHANGED and sacred: this path
// still fails CLOSED — a missing key / non-OK response / timeout / unparseable body all THROW (reusing
// the exact `MissingClaudeCredentialError` / `AgentModelTimeoutError` / `AgentModelError` classes the
// runtime already maps to a HELD run), there is deliberately no code path that returns a fabricated or
// fallback completion, and the cost-killswitch's worst-case bound is preserved by clamping wire
// `max_tokens` to `HARD_MAX_OUTPUT_TOKENS_PER_RUN` exactly as the Anthropic client did.
//
// Build-safety: the key is read LAZILY inside `generate` (process.env by NAME only, §0.4) — never at
// module scope — so `next build` and the test suite pass with no key present.

import { AGNES_MODEL_ID, AGNES_ENDPOINT, AGNES_API_KEY_ENV_VAR } from '@/types/compliance';
import { HARD_MAX_OUTPUT_TOKENS_PER_RUN } from '../runtime-model-map';
import {
  AgentGenerationRequest,
  AgentGenerationResult,
  AgentModelClient,
  AgentModelError,
  AgentModelTimeoutError,
  MissingClaudeCredentialError,
} from '../claude/runtime-client';

type FetchLike = (
  url: string,
  init: RequestInit
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Minimal shape of the Agnes (OpenAI-compatible) chat-completions body actually consumed by `parse`. */
interface AgnesChatCompletionsResponseBody {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface AgnesRuntimeClientOptions {
  /** Env-var NAME the key is read from (never its value, §0.4). Defaults to AGNES_AI_API_KEY. */
  apiKeyEnvVar?: string;
  /** Per-request timeout; a slow/hung call fails the run CLOSED. */
  timeoutMs?: number;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Endpoint override (test only). Always the Agnes endpoint in production. */
  endpoint?: string;
  /** Wire model id override (test only). Production always sends AGNES_MODEL_ID. */
  model?: string;
  /** Enable Agnes's `chat_template_kwargs.enable_thinking` (operator: "thinking on"); a first-attempt
   *  rejection of that field retries once without it (mirrors the CFE Agnes client). Default true. */
  enableThinking?: boolean;
}

export class AgnesRuntimeClient implements AgentModelClient {
  private readonly apiKeyEnvVar: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: FetchLike;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly enableThinking: boolean;

  constructor(opts: AgnesRuntimeClientOptions = {}) {
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? AGNES_API_KEY_ENV_VAR;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.fetchImpl = opts.fetchImpl;
    this.endpoint = opts.endpoint ?? AGNES_ENDPOINT;
    this.model = opts.model ?? AGNES_MODEL_ID;
    this.enableThinking = opts.enableThinking ?? true;
  }

  async generate(req: AgentGenerationRequest): Promise<AgentGenerationResult> {
    // Missing credential → fail CLOSED. No network, no fallback, no stub (safety property unchanged).
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new MissingClaudeCredentialError(this.apiKeyEnvVar);
    }

    // Defensive: the only id that can reach the wire is the Agnes model id (provider-doctrine now Agnes).
    if (!this.model || !this.model.startsWith('agnes-')) {
      throw new AgentModelError(`Refusing to call a non-Agnes model id '${this.model}'.`);
    }

    const fetchFn: FetchLike | undefined = this.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) {
      throw new AgentModelError('No fetch implementation available for the Agnes runtime client.');
    }

    let raw: string;
    try {
      raw = await this.attempt(fetchFn, apiKey, req, this.enableThinking);
    } catch (err) {
      if (err instanceof AgentModelTimeoutError || err instanceof AgentModelError) throw err;
      if (this.enableThinking) {
        raw = await this.attempt(fetchFn, apiKey, req, false);
      } else {
        throw err;
      }
    }

    return this.parse(raw, req);
  }

  private buildBody(req: AgentGenerationRequest, withThinking: boolean) {
    // CLAMP wire max_tokens to the hard cap exactly as AnthropicRuntimeClient did — this preserves the
    // cost-killswitch's worst-case reservation bound (runtime-model-map.ts, T-R27) unchanged.
    const requestedMaxTokens = req.maxTokens ?? HARD_MAX_OUTPUT_TOKENS_PER_RUN;
    return {
      model: this.model, // agnes-2.0-flash — the only model id this client ever sends
      max_tokens: Math.min(requestedMaxTokens, HARD_MAX_OUTPUT_TOKENS_PER_RUN),
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
      ...(withThinking ? { chat_template_kwargs: { enable_thinking: true } } : {}),
    };
  }

  private async attempt(
    fetchFn: FetchLike,
    apiKey: string,
    req: AgentGenerationRequest,
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
        body: JSON.stringify(this.buildBody(req, withThinking)),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        // A 429 surfaces as AgentModelError → the durable queue retries idempotently (§4.6).
        throw new AgentModelError(`Agnes request failed with status ${res.status}.`);
      }
      return text;
    } catch (err) {
      const errName = err instanceof Error ? err.name : undefined;
      if (errName === 'AbortError') {
        throw new AgentModelTimeoutError(this.timeoutMs);
      }
      if (err instanceof AgentModelError) throw err;
      throw new AgentModelError(`Agnes transport error: ${errName ?? 'unknown'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private parse(raw: string, req: AgentGenerationRequest): AgentGenerationResult {
    let json: AgnesChatCompletionsResponseBody;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AgentModelError('Agnes response was not valid JSON.');
    }

    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new AgentModelError('Agnes response contained no message content.');
    }

    const usage = json?.usage ?? {};
    return {
      text: content,
      modelId: this.model,
      tier: req.tier,
      tokenInput: Number.isFinite(usage.prompt_tokens) ? (usage.prompt_tokens as number) : 0,
      tokenOutput: Number.isFinite(usage.completion_tokens) ? (usage.completion_tokens as number) : 0,
      batched: Boolean(req.batched),
    };
  }
}
