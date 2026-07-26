import {
  AGNES_MODEL_ID,
  AGNES_ENDPOINT,
  AGNES_API_KEY_ENV_VAR,
  ClassifierVerdict,
} from '../../../types/compliance';
import {
  ClaudeClassifierClient,
  ClassifierRequest,
  ClassifierTimeoutError,
} from '../claude/client';

/**
 * T-R51 (OBSERVE variant) — Sapiens AI `agnes-2.0-flash` classifier client for the CFE's five
 * §5.3 semantic classifiers (INCOME_CLAIM/TESTIMONIAL/OPPORTUNITY/INSURANCE/REFERRAL).
 *
 * Operator-authorized, NARROWLY-SCOPED exception to the §0.3 "Claude-only" doctrine — see the
 * scope note on `AGNES_MODEL_ID` in `src/types/compliance.ts` for exactly what this does and does
 * NOT change. This client implements the SAME `ClaudeClassifierClient` interface as
 * `HaikuClassifierClient` (`../claude/haiku-client.ts`) and is a drop-in replacement at the
 * `ComplianceFilterEngine` constructor's `classifierClient` seam — §5.4 risk scoring/banding
 * (`config/classifier-rules.ts`, `engine.ts`'s `computeScore`/`bandForScore`) is completely
 * unaware of which provider produced a classifier's `{flagged, confidence, rationale}` verdict.
 *
 * Endpoint/model/call-shape (temperature 0, `chat_template_kwargs.enable_thinking`, a single
 * retry with `enable_thinking` dropped if the API rejects it, `response_format: json_object`)
 * mirror the validated `eval/agnes-compliance-harness` (`scripts/eval-agnes-compliance.mjs`) —
 * that harness IS the fitness proof this wiring is authorized on. The one deliberate difference:
 * the eval harness asked Agnes to render ONE combined PASS/FLAG/BLOCK verdict across all five
 * categories AND the vocabulary doctrine in a single call (a bespoke evaluation-only system
 * prompt); production instead reuses the CFE's own EXISTING per-classifier architecture — five
 * separate calls, each with that classifier's own `classifier-config.ts` systemPrompt (which
 * already ends in the `{flagged, confidence, rationale}` JSON contract, the exact source material
 * the eval harness's own combined prompt was assembled FROM, per that script's header comment).
 * This keeps banding, thresholds, and the vocabulary hard-block entirely in the engine/rules
 * layer — Agnes only ever answers "how confident are you this ONE category's signal is present,"
 * never renders a verdict/band itself.
 *
 * FAIL-CLOSED (§5.2, unchanged contract): missing key / non-OK response / timeout / unparseable
 * body / out-of-contract confidence all THROW — there is deliberately no code path here that
 * returns an approved/clear verdict on error, matching `HaikuClassifierClient` exactly. The engine
 * catches any throw and HOLDS the item (`held: true`), never releasing it.
 */

type FetchLike = (url: string, init: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/** Loosely-typed Agnes chat-completions response body — read with `typeof` narrowing, never
 *  trusted structurally (same discipline as `HaikuClassifierClient`'s `MessagesResponseBody`). */
interface AgnesChatCompletionsResponseBody {
  choices?: Array<{ message?: { content?: string } }>;
  [key: string]: unknown;
}

/** Missing/unset `AGNES_AI_API_KEY` → the engine fails CLOSED (no network attempt, no fallback to
 *  a different provider). Mirrors `MissingClaudeCredentialError`'s shape/intent exactly; kept as a
 *  distinct class (rather than reusing the Claude-named one) so a held item's provenance is
 *  unambiguous in logs/tests, while `engine.ts`'s `reasonFromError` maps both onto the SAME
 *  `HeldReason` value (`'missing_credentials'`) — no new held-reason vocabulary was introduced. */
export class MissingAgnesCredentialError extends Error {
  constructor(envVarName: string) {
    // NOTE: references the secret by NAME only — never its value (§0.4).
    super(`Agnes credential ${envVarName} is not set; CFE fails closed (no fallback).`);
    this.name = 'MissingAgnesCredentialError';
  }
}

/** Any other Agnes-path failure (non-OK HTTP, transport error, unparseable/out-of-contract body).
 *  Mirrors `ClaudeClassifierError`; mapped by `engine.ts`'s `reasonFromError` onto the same
 *  `'classifier_error'` `HeldReason` Haiku failures already use. */
export class AgnesClassifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgnesClassifierError';
  }
}

export interface AgnesClientOptions {
  /** Env-var NAME the key is read from (never its value, §0.4). */
  apiKeyEnvVar?: string;
  /** Per-request timeout; a slow classifier escalates to a held state (§5.2/§5.4). */
  timeoutMs?: number;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Test-only override. Production never overrides this — there is no runtime config or user
   *  input that selects a model id here, unlike `AnthropicRuntimeClient`'s tier-keyed map, so no
   *  additional defensive "starts with agnes-" runtime check is needed for the production path;
   *  this option exists solely so tests can point the client at itself deterministically. */
  model?: string;
  /** Test-only override (see `model` above). */
  endpoint?: string;
  /** Enable Agnes's `chat_template_kwargs.enable_thinking` (operator: "thinking on"). Defaults to
   *  true; a first-attempt rejection of that field falls back to a single retry without it (mirrors
   *  the eval harness's `callAgnes` fallback exactly), so a request-shape mismatch never silently
   *  fails every single classification. */
  enableThinking?: boolean;
}

export class AgnesClassifierClient implements ClaudeClassifierClient {
  private readonly apiKeyEnvVar: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: FetchLike;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly enableThinking: boolean;

  constructor(opts: AgnesClientOptions = {}) {
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? AGNES_API_KEY_ENV_VAR;
    this.timeoutMs = opts.timeoutMs ?? 2000; // matches HaikuClassifierClient's §5.2/§5.4 SLA
    this.fetchImpl = opts.fetchImpl;
    this.model = opts.model ?? AGNES_MODEL_ID;
    this.endpoint = opts.endpoint ?? AGNES_ENDPOINT;
    this.enableThinking = opts.enableThinking ?? true;
  }

  async classify(req: ClassifierRequest): Promise<ClassifierVerdict> {
    // Missing credential → fail CLOSED. No network attempt, no fallback (§5.2).
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new MissingAgnesCredentialError(this.apiKeyEnvVar);
    }

    const fetchFn: FetchLike | undefined =
      this.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) {
      throw new AgnesClassifierError('No fetch implementation available for Agnes client.');
    }

    let raw: string;
    try {
      raw = await this.attempt(fetchFn, apiKey, req, this.enableThinking);
    } catch (err) {
      if (err instanceof ClassifierTimeoutError || err instanceof AgnesClassifierError) throw err;
      // One fallback retry with the optional "thinking" kwargs dropped, in case that specific
      // field is what the API rejected — mirrors the eval harness's `callAgnes` exactly, so a
      // request-shape mismatch (we have no formal Agnes API docs) doesn't fail every call.
      if (this.enableThinking) {
        raw = await this.attempt(fetchFn, apiKey, req, false);
      } else {
        throw err;
      }
    }

    return this.parse(raw);
  }

  private buildBody(req: ClassifierRequest, withThinking: boolean) {
    return {
      model: this.model, // agnes-2.0-flash — the only model id this client ever sends
      temperature: 0, // deterministic per the eval harness's own requirement
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.content },
      ],
      response_format: { type: 'json_object' },
      ...(withThinking ? { chat_template_kwargs: { enable_thinking: true } } : {}),
    };
  }

  private async attempt(
    fetchFn: FetchLike,
    apiKey: string,
    req: ClassifierRequest,
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
        throw new AgnesClassifierError(
          `Agnes classifier request failed with status ${res.status}: ${text.slice(0, 300)}`
        );
      }
      return text;
    } catch (err) {
      const errName = err instanceof Error ? err.name : undefined;
      if (errName === 'AbortError') {
        throw new ClassifierTimeoutError(req.classifier, this.timeoutMs);
      }
      if (err instanceof AgnesClassifierError) throw err;
      throw new AgnesClassifierError(`Agnes classifier transport error: ${errName ?? 'unknown'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private parse(raw: string): ClassifierVerdict {
    let json: AgnesChatCompletionsResponseBody;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AgnesClassifierError('Agnes response was not valid JSON.');
    }

    if (json === null || typeof json !== 'object') {
      throw new AgnesClassifierError('Agnes response body was not a JSON object.');
    }

    const choice = json.choices?.[0]?.message?.content;
    if (typeof choice !== 'string' || choice.trim().length === 0) {
      throw new AgnesClassifierError('Agnes response contained no message content.');
    }

    let text = choice.trim();
    // Best-effort: strip a markdown fence if the model ignored the "no markdown fences"
    // instruction embedded in every classifier's systemPrompt's JSON_CONTRACT.
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) text = fenceMatch[1].trim();

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (!braceMatch) {
        throw new AgnesClassifierError('Agnes verdict was not JSON and contained no JSON object.');
      }
      try {
        payload = JSON.parse(braceMatch[0]);
      } catch {
        throw new AgnesClassifierError('Agnes verdict block was not valid JSON.');
      }
    }

    if (payload === null || typeof payload !== 'object') {
      throw new AgnesClassifierError('Agnes verdict missing required fields.');
    }

    const record = payload as Record<string, unknown>;
    const flagged = record.flagged;
    const confidence = record.confidence;
    if (typeof flagged !== 'boolean' || typeof confidence !== 'number') {
      throw new AgnesClassifierError('Agnes verdict missing required fields.');
    }

    // §5.2 fail-closed hardening: an out-of-contract confidence (NaN, ±Infinity, negative, >1) is
    // a MISS, never silently clamped and acted on — same rigor as HaikuClassifierClient.parse().
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new AgnesClassifierError('Agnes verdict confidence out of contract range [0,1].');
    }

    const rationale = record.rationale;
    return {
      flagged,
      confidence,
      rationale: typeof rationale === 'string' ? rationale : undefined,
    };
  }
}
