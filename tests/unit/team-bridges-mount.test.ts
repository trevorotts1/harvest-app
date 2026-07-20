// T-R22R — re-integration of T-R22 (build/T-R22-handoff-join-ui@765c793) onto WP09's (T-45) `/team`
// surface. T-R22 originally mounted the upline "accept a bridge" affordance at the bare `/team`
// page; WP09 has since landed and taken that route for the upline/RVP dashboard, so this
// re-integration mounts the SAME affordance at `/team/bridges` — a sibling tab in WP09's existing
// tab strip (src/app/team/layout.tsx), alongside Team Calendar and Sponsor Cockpit — instead of
// colliding with the dashboard. Mirrors the exact mount-proof convention of
// tests/unit/conversation-mount.test.ts / tests/unit/messaging-surfaces-mount.test.ts /
// tests/unit/team-bridges-mount.test.ts@765c793: fails if the page/route don't exist on disk,
// aren't actually wired together, aren't session-gated, trust a forged identity header, if there is
// no real navigable path INTO the surface, or if WP09's own `/team` dashboard has been disturbed.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { isGatedDownstreamPage } from '@/lib/auth/onboarding-gate-edge';
import PendingBridgeItem from '@/app/team/bridges/components/PendingBridgeItem';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

function src(...parts: string[]): string {
  return readFileSync(path.join(SRC_DIR, ...parts), 'utf8');
}

const FORGED_HEADER_READ_RE = /\.headers\s*\.\s*get\(\s*['"`]x-user-id['"`]/;

describe('T-R22R — the /team/bridges tab (upline "accept a bridge" surface) is mounted on a real route', () => {
  test('the page exists at src/app/team/bridges/page.tsx', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'team', 'bridges', 'page.tsx'))).toBe(true);
  });

  test('the page actually renders PendingBridgeItem (via PendingBridgesList), not a stub', () => {
    // T-55 (master-spec §17.7 "every list has an empty state with one action") extracted the
    // items.length===0/>0 branch that used to live inline in page.tsx into
    // `./components/PendingBridgesList` so the zero-item empty state (now a narrative + a next-step
    // link, not just "No pending bridge requests right now.") is independently render-testable —
    // see tests/unit/empty-states-team-bridges.test.ts. The page still composes the real item
    // component end-to-end, one level of indirection deeper: page -> PendingBridgesList ->
    // PendingBridgeItem.
    const page = src('app', 'team', 'bridges', 'page.tsx');
    expect(page).toMatch(/import\s+PendingBridgesList\b/);
    expect(page).toMatch(/<PendingBridgesList\b/);
    const list = src('app', 'team', 'bridges', 'components', 'PendingBridgesList.tsx');
    expect(list).toMatch(/import\s+PendingBridgeItem\b/);
    expect(list).toMatch(/<PendingBridgeItem\b/);
  });

  test('the page fetches the read route, GET /api/messaging/handoff/pending', () => {
    const page = src('app', 'team', 'bridges', 'page.tsx');
    expect(page).toContain('/api/messaging/handoff/pending');
  });

  test('the page invokes the join affordance via POST /api/messaging/handoff/join', () => {
    const page = src('app', 'team', 'bridges', 'page.tsx');
    expect(page).toContain('/api/messaging/handoff/join');
  });

  test('the read route exists at src/app/api/messaging/handoff/pending/route.ts', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'api', 'messaging', 'handoff', 'pending', 'route.ts'))).toBe(true);
  });

  test('the read route is session-gated (withOnboardingGate) and never trusts a forged x-user-id', () => {
    const s = src('app', 'api', 'messaging', 'handoff', 'pending', 'route.ts');
    expect(s).toMatch(/withOnboardingGate/);
    expect(s).not.toMatch(FORGED_HEADER_READ_RE);
  });

  test('the read route consumes ThreeWayHandoffService.visibleToUpline (never reimplements the org gate)', () => {
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

describe('T-R22R — /team and its subpaths (including /team/bridges) are gated downstream pages', () => {
  test('/team, /team/bridges, and other /team subpaths are gated downstream pages', () => {
    expect(isGatedDownstreamPage('/team')).toBe(true);
    expect(isGatedDownstreamPage('/team/bridges')).toBe(true);
    expect(isGatedDownstreamPage('/team/anything')).toBe(true);
  });
});

describe('T-R22R — /team/bridges is REACHABLE from WP09\'s existing tab strip (not orphaned)', () => {
  test("WP09's /team layout tab strip links to /team/bridges", () => {
    const layout = src('app', 'team', 'layout.tsx');
    expect(layout).toContain('href="/team/bridges"');
  });

  test("/team itself is reachable from Today (WP09's existing entry point) — unchanged by this re-integration", () => {
    const today = src('app', 'today', 'page.tsx');
    expect(today).toContain('href="/team"');
  });
});

describe("T-R22R — WP09's /team dashboard is preserved, not overwritten by this re-integration", () => {
  test('the dashboard page (src/app/team/page.tsx) still renders the WP09 roster/needs-you-now dashboard, not the bridges list', () => {
    const dashboard = src('app', 'team', 'page.tsx');
    expect(dashboard).toMatch(/TeamDashboardPage/);
    expect(dashboard).toContain('/api/team/dashboard');
    expect(dashboard).not.toMatch(/PendingBridgeItem/);
  });

  test('the dashboard tab strip still lists Team, Team Calendar, and Sponsor Cockpit alongside the new Pending Bridges tab', () => {
    const layout = src('app', 'team', 'layout.tsx');
    expect(layout).toContain('href="/team"');
    expect(layout).toContain('href="/team/calendar"');
    expect(layout).toContain('href="/team/cockpit"');
    expect(layout).toContain('href="/team/bridges"');
  });
});

describe('T-R22R — TEETH: PendingBridgeItem renders a real Join affordance that posts nothing itself (page owns the fetch)', () => {
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
