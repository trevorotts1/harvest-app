// T-57 RE-GATE fix (D states re-gate, siblings to the D2 BLOCKER): before this fix,
// `src/app/shift/page.tsx:25` and `src/app/onboarding/invite/page.tsx:154` both wrapped their
// `useSearchParams()`-reading inner component in `<Suspense fallback={null}>` — a truly blank
// render for however long that inner component is suspended.
//
// To exercise the FALLBACK itself (not the inner, post-suspend component), `next/navigation`'s
// `useSearchParams` is mocked to THROW an unresolved Promise — the real mechanism React Suspense
// uses to suspend (a thrown thenable that never settles during this render pass). This repo's
// plain `renderToStaticMarkup` (no jsdom, no streaming SSR) resolves a suspended child by
// rendering its nearest `<Suspense fallback>` — confirmed empirically below (see
// `tests/unit/t57-r3c1-new-pages-render.test.ts`'s header comment for the same mechanism, used
// there the opposite way: mocking the hook to RETURN a real value so the inner, post-suspend
// component is what's under test instead). Deliberately forcing the throw here — rather than
// relying on the real un-mocked hook returning `null` and some inner code incidentally throwing on
// it — makes this test assert the true Suspense contract (fallback renders while suspended),
// not an accident of whether a given inner component happens to guard against a null searchParams.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseSearchParams = jest.fn();
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

import ShiftPage from '@/app/shift/page';
import OnboardingInvitePage from '@/app/onboarding/invite/page';

beforeEach(() => {
  mockUseSearchParams.mockReset();
  // Never resolves within this render pass — the real mechanism a Suspense boundary is built to
  // catch, forcing the fallback (not the inner component) to be what renders.
  mockUseSearchParams.mockImplementation(() => {
    throw new Promise(() => {});
  });
});

describe('T-57 RE-GATE fix — shift/page.tsx Suspense fallback is narrated, never blank', () => {
  test('RED (pre-fix) would be: fallback={null} -> renderToStaticMarkup returns the empty string while suspended', () => {
    const html = renderToStaticMarkup(createElement(ShiftPage));
    expect(html.length).toBeGreaterThan(0);
  });

  test('GREEN: the fallback carries real narrated text ("Gathering your shift…"), not a blank aria-busy div', () => {
    const html = renderToStaticMarkup(createElement(ShiftPage));
    const text = html.replace(/<[^>]*>/g, ' ').trim();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/Gathering your shift/i);
  });

  test('the fallback region is marked aria-busy so assistive tech knows a load is in progress (in addition to the narrated text)', () => {
    const html = renderToStaticMarkup(createElement(ShiftPage));
    expect(html).toMatch(/aria-busy="true"/);
  });
});

describe('T-57 RE-GATE fix — onboarding/invite/page.tsx Suspense fallback is narrated, never blank', () => {
  test('RED (pre-fix) would be: fallback={null} -> renderToStaticMarkup returns the empty string while suspended', () => {
    const html = renderToStaticMarkup(createElement(OnboardingInvitePage));
    expect(html.length).toBeGreaterThan(0);
  });

  test('GREEN: the fallback carries real narrated text ("Finding your invite…"), reusing the SAME copy the inner loading state uses one tick later', () => {
    const html = renderToStaticMarkup(createElement(OnboardingInvitePage));
    const text = html.replace(/<[^>]*>/g, ' ').trim();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/Finding your invite/i);
  });
});
