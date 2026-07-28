// T-23 (§7.4 "Haiku 4.5 selects which category prompt to show next"; §4.4).
//
// Same DI-mockable Claude-client pattern as ../segmentation/client.ts + haiku-client.ts (T-23) and
// src/services/compliance/claude/* (T-08): an interface, a real Haiku 4.5 production
// implementation, and a deterministic local implementation for tests/dev.
//
// §0.3 AMENDED (T-R55b, operator directive 2026-07-27, see harvest-changelog.md's T-R55 entry): the
// former "Claude-only" doctrine for this workload is retired. The DEFAULT production implementation
// of `MemoryJoggerCategoryClient` is now `AgnesMemoryJoggerCategoryClient` (./agnes-category-client.ts,
// `agnes-2.0-flash`); this class (Haiku 4.5) is RETAINED, UNUSED, as an alternate for revertability. A
// missing credential throws — never a fallback to a different provider. The FAIL-CLOSED property is
// provider-independent and UNCHANGED.

import {
  ANTHROPIC_API_KEY_ENV_VAR,
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_ENDPOINT,
  HAIKU_MODEL_ID,
} from '../../../types/compliance';
import { MissingClaudeCredentialError } from '../../compliance/claude';
import {
  MEMORY_JOGGER_CATEGORY_JSON_SCHEMA,
  MEMORY_JOGGER_CATEGORY_PROMPTS,
  MemoryJoggerCategory,
  MemoryJoggerCategoryPrompt,
} from './types';

export { MissingClaudeCredentialError };

export interface MemoryJoggerCategoryRequest {
  /** Categories already shown to this rep recently, oldest→newest — avoid repeats first. */
  recentCategories: MemoryJoggerCategory[];
}

export interface MemoryJoggerCategoryClient {
  selectNextCategory(req: MemoryJoggerCategoryRequest): Promise<MemoryJoggerCategoryPrompt>;
}

export class MemoryJoggerCategoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryJoggerCategoryError';
  }
}

export class MemoryJoggerCategoryTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Memory Jogger category-selection call timed out after ${timeoutMs}ms.`);
    this.name = 'MemoryJoggerCategoryTimeoutError';
  }
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

export interface HaikuMemoryJoggerCategoryClientOptions {
  apiKeyEnvVar?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  model?: string;
  endpoint?: string;
}

const SYSTEM_PROMPT = `You pick which Memory Jogger category prompt a rep should see next in a short, swipeable
"gardening" flow that helps them recall people from their life to add to their community Vault.
Vary the category — avoid repeating one the rep has seen recently unless every category has already
been shown. Respond with exactly one category from the allowed list and a one-sentence rationale.

Never use the words prospect, lead, pitch, sales call, funnel, conversion, recruit (as an extraction
verb), cold outreach, target audience, or follower — this is a warm, personal recall exercise, not a
sales process.`;

/** The Haiku 4.5 call path (§4.4). RETAINED, UNUSED (T-R55b): `AgnesMemoryJoggerCategoryClient`
 *  (./agnes-category-client.ts) is the operator-directed DEFAULT for this workload; this class is
 *  kept only for revertability and its own unit tests. */
export class HaikuMemoryJoggerCategoryClient implements MemoryJoggerCategoryClient {
  private readonly apiKeyEnvVar: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: FetchLike;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(opts: HaikuMemoryJoggerCategoryClientOptions = {}) {
    this.apiKeyEnvVar = opts.apiKeyEnvVar ?? ANTHROPIC_API_KEY_ENV_VAR;
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.fetchImpl = opts.fetchImpl;
    this.model = opts.model ?? HAIKU_MODEL_ID;
    this.endpoint = opts.endpoint ?? ANTHROPIC_MESSAGES_ENDPOINT;
  }

  async selectNextCategory(req: MemoryJoggerCategoryRequest): Promise<MemoryJoggerCategoryPrompt> {
    // Missing credential → fail CLOSED. No network attempt, no fallback (§0.3).
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new MissingClaudeCredentialError(this.apiKeyEnvVar);
    }

    const fetchFn: FetchLike | undefined = this.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) {
      throw new MemoryJoggerCategoryError('No fetch implementation available for the Haiku Memory Jogger client.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = {
      model: this.model, // claude-haiku-4-5-20251001 (§4.4) — Claude-only
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify({ recent_categories: req.recentCategories }) }],
      output_config: { format: { type: 'json_schema', schema: MEMORY_JOGGER_CATEGORY_JSON_SCHEMA } },
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
        throw new MemoryJoggerCategoryError(`Haiku Memory Jogger request failed with status ${res.status}.`);
      }
      raw = await res.text();
    } catch (err) {
      const errName = err instanceof Error ? err.name : undefined;
      if (errName === 'AbortError') {
        throw new MemoryJoggerCategoryTimeoutError(this.timeoutMs);
      }
      if (err instanceof MemoryJoggerCategoryError) throw err;
      throw new MemoryJoggerCategoryError(`Haiku Memory Jogger transport error: ${errName ?? 'unknown'}`);
    } finally {
      clearTimeout(timer);
    }

    return this.parse(raw);
  }

  private parse(raw: string): MemoryJoggerCategoryPrompt {
    let json: MessagesResponseBody;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new MemoryJoggerCategoryError('Haiku Memory Jogger response was not valid JSON.');
    }

    let payload: MessagesResponseBody = json;
    if (Array.isArray(json?.content)) {
      const textBlock = json.content.find(
        (b): b is { type: string; text: string } => !!b && b.type === 'text' && typeof b.text === 'string'
      );
      if (!textBlock) {
        throw new MemoryJoggerCategoryError('Haiku Memory Jogger response contained no text block.');
      }
      try {
        payload = JSON.parse(textBlock.text);
      } catch {
        throw new MemoryJoggerCategoryError('Haiku Memory Jogger JSON block was not valid JSON.');
      }
    }

    // A degenerate JSON body (e.g. the literal `"null"`) or a text block whose JSON parses to
    // `null` reaches here as `payload === null` — guard before any field read so that case throws
    // the SAME domain error as a payload merely missing the fields, never a raw TypeError.
    if (payload === null || typeof payload !== 'object') {
      throw new MemoryJoggerCategoryError('Haiku Memory Jogger verdict missing a valid category.');
    }

    const category = payload.category;
    if (
      typeof category !== 'string' ||
      !(Object.values(MemoryJoggerCategory) as string[]).includes(category)
    ) {
      throw new MemoryJoggerCategoryError('Haiku Memory Jogger verdict missing a valid category.');
    }

    return {
      category: category as MemoryJoggerCategory,
      promptText: MEMORY_JOGGER_CATEGORY_PROMPTS[category as MemoryJoggerCategory],
    };
  }
}
