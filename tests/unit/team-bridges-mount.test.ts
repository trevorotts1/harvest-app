// T-R22 — the reachability proof for the upline "accept a bridge" affordance (T-40R re-QC LOW/UX
// finding: POST /api/messaging/handoff/join was API-reachable ONLY, with no rep-facing UI to even
// see a pending bridge). Mirrors the exact mount-proof convention of
// tests/unit/conversation-mount.test.ts / tests/unit/messaging-surfaces-mount.test.ts: fails if the
// page/route don't exist on disk, aren't actually wired together, aren't session-gated, trust a
// forged identity header, or if there is no real navigable path INTO the surface.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { isGatedDownstreamPage } from '@/lib/auth/onboarding-gate-edge';
import PendingBridgeItem from '@/app/team/components/PendingBridgeItem';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

function src(...parts: string[]): string {
  return readFileSync(path.join(SRC_DIR, ...parts), 'utf8');
}

const FORGED_HEADER_READ_RE = /\.headers\s*\.\s*get\(\s*['"`]x-user-id['"`]/;

describe('T-R22 — the /team page (upline "accept a bridge" surface) is mounted on a real route', () => {
  test('the page exists at src/app/team/page.tsx', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'team', 'page.tsx'))).toBe(true);
  });

  test('the page actually renders PendingBridgeItem, not a stub', () => {
    const page = src('app', 'team', 'page.tsx');
    expect(page).toMatch(/import\s+PendingBridgeItem\b/);
    expect(page).toMatch(/<PendingBridgeItem\b/);
  });

  test('the page fetches the new read route, GET /api/messaging/handoff/pending', () => {
    const page = src('app', 'team', 'page.tsx');
    expect(page).toContain('/api/messaging/handoff/pending');
  });

  test('the page invokes the join affordance via POST /api/messaging/handoff/join', () => {
    const page = src('app', 'team', 'page.tsx');
    expect(page).toContain('/api/messaging/handoff/join');
  });

  test('the new read route exists at src/app/api/messaging/handoff/pending/route.ts', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'api', 'messaging', 'handoff', 'pending', 'route.ts'))).toBe(true);
  });

  test('the new read route is session-gated (withOnboardingGate) and never trusts a forged x-user-id', () => {
    const s = src('app', 'api', 'messaging', 'handoff', 'pending', 'route.ts');
    expect(s).toMatch(/withOnboardingGate/);
    expect(s).not.toMatch(FORGED_HEADER_READ_RE);
  });

  test('the new read route consumes ThreeWayHandoffService.visibleToUpline (never reimplements the org gate)', () => {
    const s = src('app', 'api', 'messaging', 'handoff', 'pending', 'route.ts');
    expect(s).toMatch(/ThreeWayHandoffService/);
    expect(s).toMatch(/\.visibleToUpline\(/);
  });

  test('the pre-existing join route (POST /api/messaging/handoff/join) is left unmodified — still authorizes via ThreeWayHandoffService.join', () => {
    const s = src('app', 'api', 'messaging', 'handoff', 'join', 'route.ts');
    expect(s).toMatch(/ThreeWayHandoffService/);
    expect(s).toMatch(/\.join\(/);
  });
});

describe('T-R22 — /team is session-gated (no middleware regression; the prefix was already reserved)', () => {
  test('/team and its subpaths are gated downstream pages', () => {
    expect(isGatedDownstreamPage('/team')).toBe(true);
    expect(isGatedDownstreamPage('/team/anything')).toBe(true);
  });
});

describe('T-R22 — /team is REACHABLE from an existing, already-gated surface (not orphaned)', () => {
  test('Today’s AnchorHeader links to /team', () => {
    const anchor = src('app', 'today', 'components', 'AnchorHeader.tsx');
    expect(anchor).toContain('href="/team"');
  });
});

describe('T-R22 — TEETH: PendingBridgeItem renders a real Join affordance that posts nothing itself (page owns the fetch)', () => {
  const baseItem = {
    id: 'handoff-77',
    repName: 'Priya Nair',
    triggerReason: 'BUYING_SIGNAL',
    invitedAt: '2026-07-15T12:00:00.000Z',
    returnDeadlineAt: '2026-07-16T12:00:00.000Z',
  };

  test('renders the inviting rep name, the reason, and a Join button wired to the onJoin callback', () => {
    const onJoin = jest.fn().mockResolvedValue({ ok: true });
    const html = renderToStaticMarkup(createElement(PendingBridgeItem, { item: baseItem, onJoin }));
    expect(html).toContain('Priya Nair');
    expect(html).toMatch(/<button[^>]*>Join conversation<\/button>/);
    // Never renders the contact id or any conversation content — only who is asking + why.
    expect(html).not.toContain('contact-');
  });

  test('a different item renders its OWN rep name and reason, never a hardcoded/shared one', () => {
    const onJoin = jest.fn().mockResolvedValue({ ok: true });
    const html = renderToStaticMarkup(
      createElement(PendingBridgeItem, {
        item: { ...baseItem, id: 'handoff-99', repName: 'Jamie Rivera', triggerReason: 'HARD_QUESTION' },
        onJoin,
      })
    );
    expect(html).toContain('Jamie Rivera');
    expect(html).not.toContain('Priya Nair');
  });
});
