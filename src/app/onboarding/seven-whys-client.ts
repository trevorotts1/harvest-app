// R-09 — the CLIENT half of the Seven Whys conversation API (`/api/onboarding/seven-whys`).
//
// The seven_whys O-5 screen in `OnboardingFlow.tsx` used to fabricate its entire conversation
// locally: a hard-coded English question per level (`SEVEN_WHYS_QUESTIONS`), no resonance gate, and
// a single hard-coded anchor statement identical for every rep. This module is the replacement
// wire: every turn now comes from the REAL engine on the server (Agnes-driven, invisible >70
// resonance gate, per-rep composed anchor — see the route's own header), and this file is the
// client that speaks to it.
//
// Deliberately framework-free (no React import) so it can be unit-tested by stubbing
// `global.fetch` directly — the exact established pattern of `./onboarding-step-client.ts`
// (see that file's header for the rationale: this repo's Jest config is `testEnvironment: 'node'`,
// no jsdom).
//
// EVERY function returns a discriminated result, never throws for an HTTP/network-level failure —
// fail-closed callers check `.ok`, exactly like every sibling helper in onboarding-step-client.ts.
// A conversation-turn failure is never a silent local stand-in: the server is the ONLY source of
// turns, so a failed call surfaces honestly to the caller.

import type { SevenWhysRenderedTurn } from '@/services/onboarding/wp01/seven-whys';

// ─── Network result shapes ───────────────────────────────────────────────────────────────────────

export interface SevenWhysTurnSuccess {
  ok: true;
  turn: SevenWhysRenderedTurn;
}

export interface SevenWhysUnavailable {
  ok: true;
  turn: null;
  unavailable: 'no_key' | 'error';
}

export interface SevenWhysTurnFailure {
  ok: false;
  code: string | null;
}

export type SevenWhysTurnResult = SevenWhysTurnSuccess | SevenWhysUnavailable | SevenWhysTurnFailure;

export interface SevenWhysResumeSuccess {
  ok: true;
  turn: SevenWhysRenderedTurn | null;
}

export type SevenWhysResumeResult = SevenWhysResumeSuccess | SevenWhysTurnFailure;

async function parseJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function turnFromBody(body: Record<string, unknown>): SevenWhysRenderedTurn | null {
  const turn = body.turn;
  if (turn === null || turn === undefined) return null;
  return turn as SevenWhysRenderedTurn;
}

function unavailableFromBody(body: Record<string, unknown>): SevenWhysUnavailable['unavailable'] | null {
  const unavailable = body.unavailable;
  if (unavailable === 'no_key' || unavailable === 'error') return unavailable;
  return null;
}

/**
 * Starts (or resumes) the conversation. `start` returns the opening question — or, for a returning
 * rep, replays the open turn from persisted state with NO fresh engine call (uiux §5.1 O-5 "resume"
 * state). The server also answers a resume-complete state as its current turn so the UI can render
 * the completed anchor without a new submission.
 */
export async function postSevenWhysStart(
  fetchImpl: FetchLike = fetch
): Promise<SevenWhysTurnResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/onboarding/seven-whys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });
  } catch {
    return { ok: false, code: null };
  }
  const body = await parseJsonBody(response);
  if (!response.ok) {
    return { ok: false, code: typeof body.code === 'string' ? body.code : null };
  }
  const turn = turnFromBody(body);
  if (turn) return { ok: true, turn };
  const unavailable = unavailableFromBody(body);
  if (unavailable) return { ok: true, turn: null, unavailable };
  return { ok: false, code: typeof body.code === 'string' ? body.code : null };
}

/**
 * Submits the rep's answer to the currently open level and returns the next turn. The server runs
 * the engine: one question per turn, and at the final level the invisible >70 resonance gate —
 * a passing conversation completes with the composed per-rep anchor; a non-passing one renders a
 * caring re-prompt at the same point (`reprompt: true`), never a failure and never a number.
 */
export async function postSevenWhysAnswer(
  answer: string,
  fetchImpl: FetchLike = fetch
): Promise<SevenWhysTurnResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/onboarding/seven-whys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'submit', answer }),
    });
  } catch {
    return { ok: false, code: null };
  }
  const body = await parseJsonBody(response);
  if (!response.ok) {
    return { ok: false, code: typeof body.code === 'string' ? body.code : null };
  }
  const turn = turnFromBody(body);
  if (turn) return { ok: true, turn };
  const unavailable = unavailableFromBody(body);
  if (unavailable) return { ok: true, turn: null, unavailable };
  return { ok: false, code: typeof body.code === 'string' ? body.code : null };
}

/**
 * Reads the current turn from persisted state (resume on mount / after a network hiccup). Returns
 * `turn: null` when nothing is in progress yet — the caller then starts the conversation.
 */
export async function getSevenWhysTurn(
  fetchImpl: FetchLike = fetch
): Promise<SevenWhysResumeResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/onboarding/seven-whys', { method: 'GET' });
  } catch {
    return { ok: false, code: null };
  }
  const body = await parseJsonBody(response);
  if (!response.ok) {
    return { ok: false, code: typeof body.code === 'string' ? body.code : null };
  }
  return { ok: true, turn: turnFromBody(body) };
}

type FetchLike = typeof fetch;
