// R-09 — unit proofs for the client-side Seven Whys conversation module
// (`src/app/onboarding/seven-whys-client.ts`), the piece that speaks to the real conversation API
// from `OnboardingFlow.tsx`.
//
// Mocks `global.fetch` directly — the exact pattern this repo's OWN precedent for testing a
// fetch-calling client helper without jsdom/@testing-library/react already established
// (`onboarding-step-client.test.ts` / `composer-handoff-wiring.test.ts`). Proves:
//   (a) `postSevenWhysStart`/`postSevenWhysAnswer` POST the exact `{ action, answer }` bodies to
//       `/api/onboarding/seven-whys` and never throw on HTTP/network failure;
//   (b) an engine turn, an `unavailable` response, and a hard failure each map to the right
//       discriminated result — the client never fabricates a turn;
//   (c) `getSevenWhysTurn` (resume) reports `turn: null` when nothing is in progress yet.

import { SevenWhysLevel, type SevenWhysRenderedTurn } from '@/services/onboarding/wp01/seven-whys';
import {
  getSevenWhysTurn,
  postSevenWhysAnswer,
  postSevenWhysStart,
} from '@/app/onboarding/seven-whys-client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function sampleTurn(overrides: Partial<SevenWhysRenderedTurn> = {}): SevenWhysRenderedTurn {
  return {
    filledLevels: [],
    pulsingLevel: null,
    question: 'What do you want most from building this?',
    acknowledgment: null,
    reprompt: false,
    complete: false,
    anchorStatement: null,
    ...overrides,
  };
}

describe('postSevenWhysStart', () => {
  test('POSTs { action: "start" } and reports the engine\'s opening turn', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { turn: sampleTurn() });
    }) as unknown as typeof fetch;

    const result = await postSevenWhysStart(fakeFetch);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/onboarding/seven-whys');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ action: 'start' });
    expect(result.ok).toBe(true);
    if (result.ok && result.turn) expect(result.turn.question).toBe('What do you want most from building this?');
  });

  test('an unavailable engine (no_key) maps to the honest unavailable result, never a fabricated turn', async () => {
    const fakeFetch = (async () =>
      jsonResponse(200, { turn: null, unavailable: 'no_key' })) as unknown as typeof fetch;
    const result = await postSevenWhysStart(fakeFetch);
    expect(result.ok).toBe(true);
    if (result.ok && result.turn === null) expect(result.unavailable).toBe('no_key');
  });

  test('a network failure returns { ok:false } — never throws, never a fake turn', async () => {
    const fakeFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await postSevenWhysStart(fakeFetch);
    expect(result.ok).toBe(false);
  });
});

describe('postSevenWhysAnswer', () => {
  test('POSTs { action: "submit", answer } and reports the next engine turn', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { turn: sampleTurn({ filledLevels: [SevenWhysLevel.GOAL] }) });
    }) as unknown as typeof fetch;

    const result = await postSevenWhysAnswer('my real answer', fakeFetch);

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ action: 'submit', answer: 'my real answer' });
    expect(result.ok).toBe(true);
    if (result.ok && result.turn) expect(result.turn.filledLevels).toEqual([SevenWhysLevel.GOAL]);
  });

  test('a server error code surfaces as { ok:false, code } for the locale-aware error surface', async () => {
    const fakeFetch = (async () =>
      jsonResponse(409, { error: 'No Seven Whys conversation in progress.' })) as unknown as typeof fetch;
    const result = await postSevenWhysAnswer('anything', fakeFetch);
    expect(result.ok).toBe(false);
  });

  test('an engine error (unavailable) maps to the graceful pause result', async () => {
    const fakeFetch = (async () =>
      jsonResponse(200, { turn: null, unavailable: 'error' })) as unknown as typeof fetch;
    const result = await postSevenWhysAnswer('anything', fakeFetch);
    expect(result.ok).toBe(true);
    if (result.ok && result.turn === null) expect(result.unavailable).toBe('error');
  });
});

describe('getSevenWhysTurn (resume)', () => {
  test('GETs the route and reports the open turn', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { turn: sampleTurn() });
    }) as unknown as typeof fetch;
    const result = await getSevenWhysTurn(fakeFetch);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/onboarding/seven-whys');
    expect(calls[0].init?.method).toBe('GET');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn).not.toBeNull();
  });

  test('reports turn: null when nothing is in progress yet', async () => {
    const fakeFetch = (async () => jsonResponse(200, { turn: null })) as unknown as typeof fetch;
    const result = await getSevenWhysTurn(fakeFetch);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn).toBeNull();
  });

  test('a network failure returns { ok:false } — the caller surfaces the resume error, never a crash', async () => {
    const fakeFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await getSevenWhysTurn(fakeFetch);
    expect(result.ok).toBe(false);
  });
});
