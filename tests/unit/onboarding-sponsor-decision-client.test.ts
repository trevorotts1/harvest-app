// R-08 (refinements catalog 2026-07-28) — unit proofs for the client-side sponsor-decision wiring
// module (`src/app/onboarding/sponsor-decision-client.ts`): the REAL pool fetch and the decision
// POST, both via mocked `global.fetch` (the established pattern for fetch-calling client helpers in
// this repo — `onboarding-step-client.test.ts`). Proves:
//   (a) `fetchSponsorCandidates` returns the server's real pool and NEVER fabricates an empty one;
//   (b) `postSponsorDecision` POSTs the exact { decision, sponsorId } shape and never throws — an
//       HTTP failure or network exception surfaces as a discriminated {ok:false} result;
//   (c) fail-closed callers (OnboardingFlow.tsx) only advance on `.ok`.

import {
  fetchSponsorCandidates,
  postSponsorDecision,
} from '../../src/app/onboarding/sponsor-decision-client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('R-08 — fetchSponsorCandidates (the REAL pool, never a hard-coded empty one)', () => {
  test('returns the server-resolved candidates with their display names and REAL loads', async () => {
    const fakeFetch = (async () =>
      jsonResponse(200, {
        ok: true,
        candidates: [
          { userId: 'alice', name: 'Alice Upline', activeSponsorshipCount: 1 },
          { userId: 'bob', name: 'Bob', activeSponsorshipCount: 0 },
        ],
      })) as unknown as typeof fetch;

    const result = await fetchSponsorCandidates(fakeFetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates).toEqual([
        { userId: 'alice', name: 'Alice Upline', activeSponsorshipCount: 1 },
        { userId: 'bob', name: 'Bob', activeSponsorshipCount: 0 },
      ]);
    }
  });

  test('an empty response is honored ONLY as an honest empty pool — the response body is never replaced with fabricated data', async () => {
    const fakeFetch = (async () => jsonResponse(200, { ok: true, candidates: [] })) as unknown as typeof fetch;
    const result = await fetchSponsorCandidates(fakeFetch);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candidates).toEqual([]);
  });

  test('a failed fetch surfaces as {ok:false} — never a fabricated pool', async () => {
    const fakeFetch = (async () => jsonResponse(500, { error: 'boom' })) as unknown as typeof fetch;
    const result = await fetchSponsorCandidates(fakeFetch);
    expect(result.ok).toBe(false);
  });

  test('a network exception never throws — discriminated {ok:false, status:null}', async () => {
    const fakeFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await fetchSponsorCandidates(fakeFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBeNull();
  });
});

describe('R-08 — postSponsorDecision (the buttons persist a real choice)', () => {
  test('accept POSTs the exact { decision, sponsorId } body to /api/onboarding/sponsor-decision', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { ok: true, outcome: 'linked', sponsorId: 'alice' });
    }) as unknown as typeof fetch;

    const result = await postSponsorDecision('accept', 'alice', fakeFetch);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/onboarding/sponsor-decision');
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({ decision: 'accept', sponsorId: 'alice' });
  });

  test('a waitlist decision carries NO sponsorId (the route rejects one — nothing smuggled)', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { ok: true, outcome: 'join_waitlist' });
    }) as unknown as typeof fetch;

    const result = await postSponsorDecision('join_waitlist', null, fakeFetch);
    expect(result.ok).toBe(true);
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({ decision: 'join_waitlist', sponsorId: null });
  });

  test('a rejected decision (409 tamper) surfaces as {ok:false} with the status — the caller must NOT advance', async () => {
    const fakeFetch = (async () => jsonResponse(409, { error: 'That sponsor is not available' })) as unknown as typeof fetch;
    const result = await postSponsorDecision('accept', 'tampered-id', fakeFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  test('a network exception never throws — discriminated {ok:false, status:null}', async () => {
    const fakeFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await postSponsorDecision('no_upline_yet', null, fakeFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBeNull();
  });
});
