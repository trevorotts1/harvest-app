// R-08 JUDGE FIX (Findings 1 & 2) — BEHAVIORAL mount proof that the sponsor-pool Retry button
// ACTUALLY re-fetches, and that a 409 accept race surfaces honestly with a re-pick path that
// re-fetches the pool. Never advances on failure.
//
// Why a REAL mount here (unlike this repo's usual source-scan wiring proofs): the judge's Finding 1
// is a *behavioral* React bug — the pre-fix retry handler only cleared two state flags that are NOT
// effect dependencies, so the pool fetch never re-ran and the rep was stuck on a blank sponsor
// screen after "Try again". A source scan cannot prove a retry re-runs an effect; only a mounted
// component with flushed effects can. `react-test-renderer` v18 (matching react@18.3) runs in this
// repo's plain-node Jest env (no jsdom, no @testing-library — see jest.config.js), with `act()`
// driving state/effect flushing. `next/navigation` is mocked (the established pattern from
// auth-page-i18n.test.ts — useRouter throws outside a mounted App Router), and the sponsor client
// module is mocked so the pool fetch / decision POST are controllable, deterministic promises.
//
// FAIL-CLOSED CONTRACT UNDER TEST: the Retry button re-runs the pool fetch (re-fetch called, loading
// rendered, fresh outcome returned); a 409 accept race renders the honest "sponsor no longer
// available" copy with a re-pick that re-fetches; nothing ever advances the rep on a failure.

import { Role } from '@prisma/client';
import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/app/onboarding/sponsor-decision-client', () => ({
  fetchSponsorCandidates: jest.fn(),
  postSponsorDecision: jest.fn(),
}));

import OnboardingFlow from '@/app/onboarding/OnboardingFlow';
import {
  fetchSponsorCandidates,
  postSponsorDecision,
  type SponsorDecisionResult,
  type SponsorPreviewResult,
} from '@/app/onboarding/sponsor-decision-client';

const fetchSponsorCandidatesMock = jest.mocked(fetchSponsorCandidates);
const postSponsorDecisionMock = jest.mocked(postSponsorDecision);

// React 18 requires an explicitly-act-enabled environment for `act()` outside react-dom/test-utils.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const POOL_OK: SponsorPreviewResult = {
  ok: true,
  candidates: [{ userId: 'alice', name: 'Alice Upline', activeSponsorshipCount: 1 }],
};
const POOL_FAIL: SponsorPreviewResult = { ok: false, status: 500 };

/** The visible text of a rendered tree, entity/whitespace-normalized (same approach as the
 *  repo's renderToStaticMarkup textOf() helpers). */
function textOf(tree: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON())
    .replace(/<[^>]*>/g, ' ')
    .replace(/\\n/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buttonWithText(tree: TestRenderer.ReactTestRenderer, text: string) {
  return tree.root.findAll((n) => n.type === 'button').find((b) => (b.children as readonly unknown[]).join('') === text);
}

/** Queues the NEXT pool fetch as a promise the test resolves manually — every fetch in this suite
 *  goes through this helper so its settlement lands inside an `await act(...)` and the in-flight
 *  loading render is observable (an auto-resolving mock would settle outside the act boundary). */
function pendingPoolFetch(): { resolve: (r: SponsorPreviewResult) => void } {
  // NOTE: the executor assigns THROUGH the returned object (`pending.resolve = res`), never to a
  // local variable captured at return time — `return { resolve }` would snapshot the still-undefined
  // current value and the suite would crash with "resolve is not a function" at settlement.
  const pending: { resolve: (r: SponsorPreviewResult) => void } = {
    resolve: () => {
      throw new Error('pool fetch promise not yet created');
    },
  };
  fetchSponsorCandidatesMock.mockImplementationOnce(
    () => new Promise<SponsorPreviewResult>((res) => { pending.resolve = res; })
  );
  return pending;
}

/** Mounts the flow straight onto the sponsor screen and waits for the FIRST pool fetch's promise
 *  to be created (the effect runs inside the mount act; the test then settles the fetch). */
function mountSponsorScreen(): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(createElement(OnboardingFlow, { initialScreen: 'sponsor', role: Role.REP }));
  });
  return tree;
}

async function settlePool(pending: { resolve: (r: SponsorPreviewResult) => void }, result: SponsorPreviewResult) {
  await act(async () => {
    pending.resolve(result);
  });
}

beforeEach(() => {
  fetchSponsorCandidatesMock.mockReset();
  postSponsorDecisionMock.mockReset();
});

describe('R-08 judge Finding 1 — the sponsor-pool Retry ACTUALLY re-fetches', () => {
  test('pool error → Retry → re-fetch runs, loading returns, fresh outcome renders', async () => {
    const firstFetch = pendingPoolFetch();
    const tree = mountSponsorScreen();
    await settlePool(firstFetch, POOL_FAIL);

    // The error branch with the Retry button is rendered (never a blank screen).
    expect(textOf(tree)).toContain('We couldn’t load available sponsors');
    expect(buttonWithText(tree, 'Try again')).toBeDefined();

    // The retry's re-fetch is queued as a pending promise so the loading state is observable.
    const retryFetch = pendingPoolFetch();
    await act(async () => {
      buttonWithText(tree, 'Try again')!.props.onClick();
    });

    // The retry RE-RAN the pool fetch (the pre-fix handler never did — this is the judge's bug),
    // and the loading render is back while the fresh fetch is in flight.
    expect(fetchSponsorCandidatesMock).toHaveBeenCalledTimes(2);
    expect(textOf(tree)).toContain('Finding the right sponsor for you');
    expect(buttonWithText(tree, 'Try again')).toBeUndefined();

    // The fresh pool resolves → the linked outcome returns (not stuck, not waitlisted).
    await settlePool(retryFetch, POOL_OK);
    expect(textOf(tree)).toContain('We found your Downline Sponsor');
    expect(textOf(tree)).toContain('Accept');
  });

  test('a second failure stays on the honest error branch — Retry is re-clickable, never blank', async () => {
    const firstFetch = pendingPoolFetch();
    const tree = mountSponsorScreen();
    await settlePool(firstFetch, POOL_FAIL);
    expect(buttonWithText(tree, 'Try again')).toBeDefined();

    const retryFetch = pendingPoolFetch();
    await act(async () => {
      buttonWithText(tree, 'Try again')!.props.onClick();
    });
    await settlePool(retryFetch, POOL_FAIL);

    // Still the honest error branch (fail-closed, no fabricated pool, no blank screen).
    expect(fetchSponsorCandidatesMock).toHaveBeenCalledTimes(2);
    expect(textOf(tree)).toContain('We couldn’t load available sponsors');
    expect(buttonWithText(tree, 'Try again')).toBeDefined();
  });
});

describe('R-08 judge Finding 2 — the 409 accept race is honest and re-pickable', () => {
  test('409 on accept → honest copy + re-pick that re-fetches; the rep never advances', async () => {
    const firstFetch = pendingPoolFetch();
    const tree = mountSponsorScreen();
    await settlePool(firstFetch, POOL_OK);

    // The linked sponsor preview is showing (server-resolved REAL pool).
    expect(textOf(tree)).toContain('We found your Downline Sponsor');

    // A sponsorship landed between preview and click: the server re-derives the pick from fresh
    // state and 409s this honest rep.
    postSponsorDecisionMock.mockResolvedValueOnce({ ok: false, status: 409 } satisfies SponsorDecisionResult);
    await act(async () => {
      buttonWithText(tree, 'Accept')!.props.onClick();
    });

    // The honest 409 copy + a re-pick path replace the stale preview — NEVER an advance, and the
    // client-computed sponsorId that just failed is exactly what the server re-verified.
    expect(postSponsorDecisionMock).toHaveBeenCalledWith('accept', 'alice');
    expect(textOf(tree)).toContain('That sponsor is no longer available');
    expect(buttonWithText(tree, 'See updated sponsors')).toBeDefined();
    expect(textOf(tree)).not.toContain('We found your Downline Sponsor');

    // Re-pick re-fetches the pool (the SAME retry mechanism from Finding 1), shows loading, and
    // returns a fresh preview so the rep can re-choose.
    const repickFetch = pendingPoolFetch();
    await act(async () => {
      buttonWithText(tree, 'See updated sponsors')!.props.onClick();
    });
    expect(fetchSponsorCandidatesMock).toHaveBeenCalledTimes(2);
    expect(textOf(tree)).toContain('Finding the right sponsor for you');
    await settlePool(repickFetch, POOL_OK);
    expect(textOf(tree)).toContain('We found your Downline Sponsor');
    expect(textOf(tree)).toContain('Accept');
  });

  test('a generic (non-409) decision failure keeps the existing generic-error surface — still no advance', async () => {
    const firstFetch = pendingPoolFetch();
    const tree = mountSponsorScreen();
    await settlePool(firstFetch, POOL_OK);

    postSponsorDecisionMock.mockResolvedValueOnce({ ok: false, status: 500, code: undefined } satisfies SponsorDecisionResult);
    await act(async () => {
      buttonWithText(tree, 'Accept')!.props.onClick();
    });

    // The pre-existing honest generic error remains (errorDisplay's errors.generic), the sponsor
    // preview stays on screen, and the rep is still not advanced.
    expect(textOf(tree)).toContain('Something went wrong. Please try again.');
    expect(textOf(tree)).toContain('Accept');
    expect(textOf(tree)).not.toContain('That sponsor is no longer available');
  });
});
