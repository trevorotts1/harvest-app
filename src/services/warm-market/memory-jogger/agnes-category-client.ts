// T-23 (§7.4) / T-R55b — Agnes (`agnes-2.0-flash`) Memory Jogger category-selection client.
//
// Wired as the DEFAULT production implementation of `MemoryJoggerCategoryClient` per OPERATOR
// DIRECTIVE (2026-07-27): "Use my Agnes AI API key for anything where Anthropic was used previously"
// (see T-R55's `AgnesRuntimeClient`, src/services/agent-runtime/agnes/, and the CFE's
// `AgnesClassifierClient`, src/services/compliance/agnes/ — this client mirrors both byte-for-byte in
// structure). `HaikuMemoryJoggerCategoryClient` (./category-client.ts) is RETAINED, UNUSED, so its
// unit tests and the option to revert remain intact.
//
// §0.3 AMENDED (operator directive, see harvest-changelog.md's T-R55 entry): the prior "Claude-only"
// doctrine for this selection path is retired. Agnes is now the DEFAULT provider. The FAIL-CLOSED
// property is provider-independent and UNCHANGED: a missing key / non-OK response / timeout /
// unparseable body all THROW — reusing the SAME `MemoryJoggerCategoryError` /
// `MemoryJoggerCategoryTimeoutError` / `MissingClaudeCredentialError` classes the caller already
// expects — there is deliberately no code path here that returns a fabricated category on error.
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
import { MissingClaudeCredentialError } from '../../compliance/claude';
import {
  MemoryJoggerCategoryClient,
  MemoryJoggerCategoryError,
  MemoryJoggerCategoryRequest,
  MemoryJoggerCategoryTimeoutError,
} from './category-client';
import {
  MEMORY_JOGGER_CATEGORY_PROMPTS,
  MemoryJoggerCategory,
  MemoryJoggerCategoryPrompt,
} from './types';

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

export interface AgnesMemoryJoggerCategoryClientOptions {
  apiKeyEnvVar?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  model?: string;
  endpoint?: string;
  /** Enable Agnes's `chat_template_kwargs.enable_thinking`; a first-attempt rejection of that field
   *  falls back to a single retry without it (mirrors `AgnesRuntimeClient`/`AgnesClassifierClient`
   *  exactly). Defaults to true. */
  enableThinking?: boolean;
}

const JSON_CONTRACT =
  'Respond ONLY with a JSON object, no markdown fences: {"category": string, "rationale": string}. ' +
  `\`category\` MUST be exactly one of: ${Object.values(MemoryJoggerCategory).join(', ')}.`;

const SYSTEM_PROMPT = `You pick which Memory Jogger category prompt a rep should see next in a short, swipeable
"gardening" flow that helps them recall people from their life to add to their community Vault.
Vary the category — avoid repeating one the rep has seen recently unless every category has already
been shown. Respond with exactly one category from the allowed list and a one-sentence rationale.

Never use the words prospect, lead, pitch, sales call, funnel, conversion, recruit (as an extraction
verb), cold outreach, target audience, or follower — this is a warm, personal recall exercise, not a
sales process.

${JSON_CONTRACT}`;

/** Production category-selection client (§4.4, T-R55b): the real Agnes `agnes-2.0-flash` call path —
 *  the operator-directed DEFAULT for this workload. */
export class AgnesMemoryJoggerCategoryClient implements MemoryJoggerCategoryClient {
  private readonly apiKeyEnvVar: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: FetchLike;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly enableThinking: boolean;

  constructor(opts: AgnesMemoryJoggerCategoryClientOptions = {}) {
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? AGNES_API_KEY_ENV_VAR;
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.fetchImpl = opts.fetchImpl;
    this.model = opts.model ?? AGNES_MODEL_ID;
    this.endpoint = opts.endpoint ?? AGNES_ENDPOINT;
    this.enableThinking = opts.enableThinking ?? true;
  }

  async selectNextCategory(req: MemoryJoggerCategoryRequest): Promise<MemoryJoggerCategoryPrompt> {
    // Missing credential → fail CLOSED. No network attempt, no fallback.
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new MissingClaudeCredentialError(this.apiKeyEnvVar);
    }

    const fetchFn: FetchLike | undefined = this.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) {
      throw new MemoryJoggerCategoryError('No fetch implementation available for the Agnes Memory Jogger client.');
    }

    const userContent = JSON.stringify({ recent_categories: req.recentCategories });

    let raw: string;
    try {
      raw = await this.attempt(fetchFn, apiKey, userContent, this.enableThinking);
    } catch (err) {
      if (err instanceof MemoryJoggerCategoryTimeoutError || err instanceof MemoryJoggerCategoryError) throw err;
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
      max_tokens: 200,
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
        throw new MemoryJoggerCategoryError(`Agnes Memory Jogger request failed with status ${res.status}: ${text.slice(0, 300)}`);
      }
      return text;
    } catch (err) {
      const errName = err instanceof Error ? err.name : undefined;
      if (errName === 'AbortError') {
        throw new MemoryJoggerCategoryTimeoutError(this.timeoutMs);
      }
      if (err instanceof MemoryJoggerCategoryError) throw err;
      throw new MemoryJoggerCategoryError(`Agnes Memory Jogger transport error: ${errName ?? 'unknown'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private parse(raw: string): MemoryJoggerCategoryPrompt {
    let json: AgnesChatCompletionsResponseBody;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new MemoryJoggerCategoryError('Agnes Memory Jogger response was not valid JSON.');
    }

    if (json === null || typeof json !== 'object') {
      throw new MemoryJoggerCategoryError('Agnes Memory Jogger verdict missing a valid category.');
    }

    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new MemoryJoggerCategoryError('Agnes Memory Jogger response contained no message content.');
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
        throw new MemoryJoggerCategoryError('Agnes Memory Jogger reply was not JSON and contained no JSON object.');
      }
      try {
        payload = JSON.parse(braceMatch[0]);
      } catch {
        throw new MemoryJoggerCategoryError('Agnes Memory Jogger reply JSON block was not valid JSON.');
      }
    }

    // A degenerate JSON body (e.g. the literal `"null"`) reaches here as `payload === null` — guard
    // before any field read so that case throws the SAME domain error as a payload merely missing
    // the fields, never a raw TypeError.
    if (payload === null || typeof payload !== 'object') {
      throw new MemoryJoggerCategoryError('Agnes Memory Jogger verdict missing a valid category.');
    }

    const record = payload as Record<string, unknown>;
    const category = record.category;
    if (
      typeof category !== 'string' ||
      !(Object.values(MemoryJoggerCategory) as string[]).includes(category)
    ) {
      throw new MemoryJoggerCategoryError('Agnes Memory Jogger verdict missing a valid category.');
    }

    return {
      category: category as MemoryJoggerCategory,
      promptText: MEMORY_JOGGER_CATEGORY_PROMPTS[category as MemoryJoggerCategory],
    };
  }
}
