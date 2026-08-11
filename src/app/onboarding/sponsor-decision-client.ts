// R-08 (refinements catalog 2026-07-28) — the CLIENT half of the sponsor-outcome wiring:
// (a) resolving the REAL candidate pool from the server so the sponsor screen is never fed a
//     hard-coded empty one, and (b) POSTing the rep's chosen decision to the new
//     `/api/onboarding/sponsor-decision` route so the buttons persist a real choice server-side.
//
// Deliberately framework-free (no React, no DOM) so it is unit-testable by stubbing
// `global.fetch` directly — the exact pattern `onboarding-step-client.ts` already established for
// fetch-calling client helpers in this repo (testEnvironment 'node', no jsdom).
//
// FAIL-CLOSED: every function returns a discriminated result and never throws for an HTTP-level or
// network-level failure — the caller shows an honest error and does NOT advance the rep.

export interface SponsorDecisionSuccess {
  ok: true;
  outcome: 'linked' | 'join_waitlist' | 'start_paid' | 'no_upline_yet';
  sponsorId?: string;
}
export interface SponsorDecisionFailure {
  ok: false;
  /** HTTP status, or `null` if the request never reached the server (network exception). */
  status: number | null;
  /** The route's machine `code`, when it set one (most failures do not — callers fall back to
   *  `errorDisplay`'s documented `errors.generic` behavior, exactly like `/step`'s call sites). */
  code?: string;
}
export type SponsorDecisionResult = SponsorDecisionSuccess | SponsorDecisionFailure;

export interface SponsorCandidateDto {
  userId: string;
  /** The sponsor's display name, resolved server-side from their real `User.name`. */
  name: string;
  /**
   * The candidate's REAL active-sponsorship load, resolved server-side — carried so the client's
   * displayed verdict (`matchSponsor`'s least-loaded rule) uses the exact same weights the accept
   * route re-derives; the sponsor a rep sees matched is the sponsor that will be persisted.
   */
  activeSponsorshipCount: number;
}

export interface SponsorPreviewSuccess {
  ok: true;
  /** The rep's real, server-resolved candidate pool (same org type, sponsor-eligible, never an
   *  RVP — R-01's pairing policy). Empty ONLY when the platform genuinely has no eligible
   *  candidate for this org type — the sole condition under which the rep is honestly waitlisted. */
  candidates: SponsorCandidateDto[];
}
export interface SponsorPreviewFailure {
  ok: false;
  /** HTTP status, or `null` if the request never reached the server (network exception). */
  status: number | null;
}
export type SponsorPreviewResult = SponsorPreviewSuccess | SponsorPreviewFailure;

type FetchLike = typeof fetch;

async function parseJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * GET the rep's real sponsor candidate pool. The response is keyed by the authenticated session
 * (never a header), scoped to the rep's own org type, and ordered by the server's deterministic
 * ranking — the client can only ever choose from what the server actually resolved.
 */
export async function fetchSponsorCandidates(fetchImpl: FetchLike = fetch): Promise<SponsorPreviewResult> {
  try {
    const response = await fetchImpl('/api/onboarding/sponsor-decision', { method: 'GET' });
    const body = await parseJsonBody(response);
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const candidates = Array.isArray(body.candidates) ? (body.candidates as SponsorCandidateDto[]) : [];
    return { ok: true, candidates };
  } catch {
    return { ok: false, status: null };
  }
}

/**
 * POST the rep's sponsor-step decision to the real route. `accept` carries the chosen sponsor id
 * (the server re-verifies it against its own matcher's pick before persisting anything); the
 * waitlist/"no upline yet" paths carry no id at all. Success is the ONLY condition under which a
 * caller may advance past the sponsor screen.
 */
export async function postSponsorDecision(
  decision: 'accept' | 'join_waitlist' | 'start_paid' | 'no_upline_yet',
  sponsorId: string | null,
  fetchImpl: FetchLike = fetch
): Promise<SponsorDecisionResult> {
  try {
    const response = await fetchImpl('/api/onboarding/sponsor-decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, sponsorId }),
    });
    const body = await parseJsonBody(response);
    if (!response.ok) {
      return { ok: false, status: response.status, code: body.code as string | undefined };
    }
    return {
      ok: true,
      outcome: (body.outcome as SponsorDecisionSuccess['outcome']) ?? decision,
      sponsorId: body.sponsorId as string | undefined,
    };
  } catch {
    return { ok: false, status: null };
  }
}
