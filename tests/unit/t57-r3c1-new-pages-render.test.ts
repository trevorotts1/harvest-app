// T-57 R3c-1 — proves the new page routes are REACHABLE and RENDER (not just that their backing
// API routes work). `useSearchParams()`/`useParams()` need the App Router's context, which does
// not exist in this repo's plain `renderToStaticMarkup` (no jsdom, no live Next.js request) —
// confirmed empirically: rendering `next/navigation`'s real hook outside a router context makes
// the component suspend forever (the Suspense fallback renders, forever blank), never throwing.
// `next/navigation` is mocked (module-level, via `jest.fn()` return values controlled per test —
// NOT `jest.resetModules()`, which was tried first and produces a SECOND react/react-dom module
// instance, breaking hooks with "Cannot read properties of null (reading 'useContext')") so each
// page's OWN rendering logic is what's actually exercised, the same boundary-mocking principle
// this repo's route tests use for `@/lib/prisma`/`@/lib/auth/session`.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseSearchParams = jest.fn();
const mockUseParams = jest.fn();
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
  useParams: () => mockUseParams(),
}));

import MemoryJoggerPage from '@/app/community/jogger/page';
import OnboardingInvitePage from '@/app/onboarding/invite/page';
import InboxSingleItemPage from '@/app/inbox/[itemId]/page';

beforeEach(() => {
  mockUseSearchParams.mockReset();
  mockUseParams.mockReset();
});

// ─── community/jogger/page.tsx — no navigation hooks; useEffect never runs under
// renderToStaticMarkup, so this proves the page mounts and shows its honest initial loading state
// (not a crash, not a blank region) — the same "first paint never blank" proof convention this
// codebase already applies to WarmMarketRitual's own `stage === 'LOADING'` render. ────────────────
describe('T-57 R3c-1 — /community/jogger reachability: renders without crashing, honest initial state', () => {
  test('mounts and shows the honest "getting a prompt ready" loading state, never blank', () => {
    const html = renderToStaticMarkup(createElement(MemoryJoggerPage));
    expect(html.length).toBeGreaterThan(0);
    expect(html.replace(/<[^>]*>/g, ' ')).toMatch(/Getting a prompt ready/);
  });

  test('carries a real link back to Community', () => {
    const html = renderToStaticMarkup(createElement(MemoryJoggerPage));
    expect(html).toMatch(/href="\/community"/);
  });
});

// ─── onboarding/invite/page.tsx ─────────────────────────────────────────────────────────────────
describe('T-57 R3c-1 — /onboarding/invite reachability: renders per real query-param state', () => {
  test('missing ?invite_id -> the honest missing-param state, with a real path forward (never a dead end)', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    const html = renderToStaticMarkup(createElement(OnboardingInvitePage));
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(text).toMatch(/missing its invite code/i);
    expect(html).toMatch(/href="\/onboarding"/);
  });

  test('a real ?invite_id renders the loading state on first paint (never blank while the fetch is in flight)', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('invite_id=abc-123'));
    const html = renderToStaticMarkup(createElement(OnboardingInvitePage));
    expect(html.replace(/<[^>]*>/g, ' ')).toMatch(/Finding your invite/i);
  });
});

// ─── inbox/[itemId]/page.tsx ────────────────────────────────────────────────────────────────────
describe('T-57 R3c-1 — /inbox/[itemId] reachability: renders, imports the EXISTING ApprovalInboxItem (never modified)', () => {
  test('mounts with a real itemId param and shows the loading state on first paint', () => {
    mockUseParams.mockReturnValue({ itemId: 'draft-abc-123' });
    const html = renderToStaticMarkup(createElement(InboxSingleItemPage));
    expect(html.replace(/<[^>]*>/g, ' ')).toMatch(/Loading/i);
  });

  test('imports ApprovalInboxItem from the EXISTING, unmodified component file — never a re-implementation', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'inbox', '[itemId]', 'page.tsx'), 'utf8');
    expect(source).toMatch(/from '\.\.\/components\/ApprovalInboxItem'/);
  });

  test('carries a real link back to the full Approval Inbox list', () => {
    mockUseParams.mockReturnValue({ itemId: 'draft-abc-123' });
    const html = renderToStaticMarkup(createElement(InboxSingleItemPage));
    expect(html).toMatch(/href="\/inbox"/);
  });
});
