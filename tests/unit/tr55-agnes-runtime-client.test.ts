// T-R55 — AgnesRuntimeClient (the operator-directed agent-generation provider, agnes-2.0-flash).
// Proves: (a) generation routes to the Agnes chat/completions endpoint and parses its OpenAI-shaped
// body; (b) the SAFETY property is preserved unchanged — missing key / non-OK / timeout / unparseable
// all FAIL CLOSED (throw, no fabricated completion, no fallback); (c) the cost-killswitch worst-case
// bound is preserved (wire max_tokens clamped to the hard cap); (d) only the agnes-* model id can
// reach the wire.
import { AgnesRuntimeClient } from '../../src/services/agent-runtime/agnes';
import {
  AgentModelError,
  AgentModelTimeoutError,
  MissingClaudeCredentialError,
} from '../../src/services/agent-runtime/claude';
import { ClaudeModelTier, HARD_MAX_OUTPUT_TOKENS_PER_RUN } from '../../src/services/agent-runtime/runtime-model-map';

const KEY = 'AGNES_AI_API_KEY';
function req(overrides: Record<string, unknown> = {}) {
  return {
    tier: ClaudeModelTier.SONNET_5,
    systemPrompt: 'doctrine system prompt',
    userPrompt: 'draft a warm intro',
    ...overrides,
  } as never;
}
function okBody(text = 'Hi there, would love to share something with you.') {
  return JSON.stringify({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 12, completion_tokens: 20 },
  });
}

describe('T-R55 AgnesRuntimeClient — Agnes generation provider, fail-closed', () => {
  const prior = process.env[KEY];
  afterEach(() => {
    if (prior === undefined) delete process.env[KEY];
    else process.env[KEY] = prior;
  });

  test('missing AGNES key → MissingClaudeCredentialError BEFORE any network attempt (fail-closed)', async () => {
    delete process.env[KEY];
    let called = false;
    const client = new AgnesRuntimeClient({
      fetchImpl: (async () => {
        called = true;
        return { ok: true, status: 200, text: async () => okBody() };
      }) as never,
    });
    await expect(client.generate(req())).rejects.toBeInstanceOf(MissingClaudeCredentialError);
    expect(called).toBe(false);
  });

  test('valid key → routes to Agnes, parses choices[0].message.content, reports agnes model id + usage', async () => {
    process.env[KEY] = 'test-agnes-key';
    let sentUrl = '';
    let sentBody: Record<string, unknown> = {};
    const client = new AgnesRuntimeClient({
      fetchImpl: (async (url: string, init: { body: string }) => {
        sentUrl = url;
        sentBody = JSON.parse(init.body);
        return { ok: true, status: 200, text: async () => okBody('Warm intro draft.') };
      }) as never,
    });
    const res = await client.generate(req());
    expect(res.text).toBe('Warm intro draft.');
    expect(res.modelId).toBe('agnes-2.0-flash');
    expect(res.tier).toBe(ClaudeModelTier.SONNET_5);
    expect(res.tokenInput).toBe(12);
    expect(res.tokenOutput).toBe(20);
    expect(sentUrl).toContain('agnes-ai.com');
    expect(sentBody.model).toBe('agnes-2.0-flash');
    expect(Array.isArray(sentBody.messages)).toBe(true);
  });

  test('clamps wire max_tokens to HARD_MAX_OUTPUT_TOKENS_PER_RUN even when a caller requests more', async () => {
    process.env[KEY] = 'test-agnes-key';
    let sentBody: Record<string, unknown> = {};
    const client = new AgnesRuntimeClient({
      fetchImpl: (async (_url: string, init: { body: string }) => {
        sentBody = JSON.parse(init.body);
        return { ok: true, status: 200, text: async () => okBody() };
      }) as never,
    });
    await client.generate(req({ maxTokens: HARD_MAX_OUTPUT_TOKENS_PER_RUN * 10 }));
    expect(sentBody.max_tokens).toBe(HARD_MAX_OUTPUT_TOKENS_PER_RUN);
  });

  test('non-OK HTTP status → AgentModelError (fail-closed, no completion returned)', async () => {
    process.env[KEY] = 'test-agnes-key';
    const client = new AgnesRuntimeClient({
      // enableThinking default true → one retry; both attempts return 500 → still throws.
      fetchImpl: (async () => ({ ok: false, status: 500, text: async () => 'upstream error' })) as never,
    });
    await expect(client.generate(req())).rejects.toBeInstanceOf(AgentModelError);
  });

  test('abort/timeout → AgentModelTimeoutError (fail-closed)', async () => {
    process.env[KEY] = 'test-agnes-key';
    const client = new AgnesRuntimeClient({
      fetchImpl: (async () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }) as never,
    });
    await expect(client.generate(req())).rejects.toBeInstanceOf(AgentModelTimeoutError);
  });

  test('unparseable body → AgentModelError (never a fabricated completion)', async () => {
    process.env[KEY] = 'test-agnes-key';
    const client = new AgnesRuntimeClient({
      fetchImpl: (async () => ({ ok: true, status: 200, text: async () => 'not json at all' })) as never,
    });
    await expect(client.generate(req())).rejects.toBeInstanceOf(AgentModelError);
  });

  test('empty/whitespace content → AgentModelError (no silent empty send)', async () => {
    process.env[KEY] = 'test-agnes-key';
    const client = new AgnesRuntimeClient({
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: '   ' } }] }),
      })) as never,
    });
    await expect(client.generate(req())).rejects.toBeInstanceOf(AgentModelError);
  });

  test('defensive: refuses a non-agnes model id (provider is Agnes-only now)', async () => {
    process.env[KEY] = 'test-agnes-key';
    let called = false;
    const client = new AgnesRuntimeClient({
      model: 'claude-opus-4-8',
      fetchImpl: (async () => {
        called = true;
        return { ok: true, status: 200, text: async () => okBody() };
      }) as never,
    });
    await expect(client.generate(req())).rejects.toBeInstanceOf(AgentModelError);
    expect(called).toBe(false);
  });
});
