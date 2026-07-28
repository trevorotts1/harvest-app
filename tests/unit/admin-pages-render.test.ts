// T-R56 (admin console) — proves the new /admin/** page routes are REACHABLE and RENDER without
// crashing (never blank, per §17.7), mirroring tests/unit/t57-r3c1-new-pages-render.test.ts's exact
// method: `renderToStaticMarkup` (this repo's Jest env has no jsdom) with `next-auth/react` mocked
// (module-level, controlled per test) since `useSession()` throws outside a `<SessionProvider>` —
// confirmed empirically, unlike `next/navigation`'s hooks which merely suspend forever.
//
// `src/app/admin/layout.tsx` is the ONLY new file that calls `useSession()` directly (every other
// admin page below it uses `useLocale()`/`useT()` only) — this is also the proof that ADMIN-gating
// is real at the UI layer, not just a decorative check: a non-ADMIN role renders the forbidden
// state and NEVER the console nav/links.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Role } from '@prisma/client';

const mockUseSession = jest.fn();
jest.mock('next-auth/react', () => ({ useSession: () => mockUseSession() }));

import AdminLayout from '@/app/admin/layout';
import AdminOverviewPage from '@/app/admin/page';
import AdminUsersPage from '@/app/admin/users/page';
import AdminSignupsActivityPage from '@/app/admin/signups/page';
import AdminKillSwitchPage from '@/app/admin/kill-switch/page';
import AdminAuditPage from '@/app/admin/audit/page';

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

beforeEach(() => {
  mockUseSession.mockReset();
});

describe('T-R56 — /admin/layout: real ADMIN-gating at the UI layer', () => {
  test('session loading -> the honest loading state, never blank, never the nav', () => {
    mockUseSession.mockReturnValue({ data: undefined, status: 'loading' });
    const html = renderToStaticMarkup(createElement(AdminLayout, { children: createElement('div', null, 'child') }));
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('data-nav');
    expect(html).not.toMatch(/child/);
  });

  test('a REP session never sees the admin nav/links or the children — forbidden state only', () => {
    mockUseSession.mockReturnValue({ data: { user: { role: Role.REP } }, status: 'authenticated' });
    const html = renderToStaticMarkup(createElement(AdminLayout, { children: createElement('div', null, 'SECRET_ADMIN_CHILD') }));
    expect(html).not.toMatch(/SECRET_ADMIN_CHILD/);
    expect(html).not.toContain('href="/admin/users"');
  });

  test('an unauthenticated (no session) request never sees the admin nav/links or the children', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    const html = renderToStaticMarkup(createElement(AdminLayout, { children: createElement('div', null, 'SECRET_ADMIN_CHILD') }));
    expect(html).not.toMatch(/SECRET_ADMIN_CHILD/);
  });

  test('an ADMIN session renders the console shell: nav links to every section + the children', () => {
    mockUseSession.mockReturnValue({ data: { user: { role: Role.ADMIN } }, status: 'authenticated' });
    const html = renderToStaticMarkup(createElement(AdminLayout, { children: createElement('div', null, 'REAL_CHILD') }));
    expect(html).toMatch(/REAL_CHILD/);
    expect(html).toContain('href="/admin/users"');
    expect(html).toContain('href="/admin/signups"');
    expect(html).toContain('href="/admin/kill-switch"');
    expect(html).toContain('href="/admin/audit"');
  });
});

describe('T-R56 — /admin (overview) reachability: renders the honest initial loading state', () => {
  test('mounts and shows a real, non-blank first paint', () => {
    const html = renderToStaticMarkup(createElement(AdminOverviewPage));
    expect(html.length).toBeGreaterThan(0);
    expect(textOf(html)).toMatch(/Loading snapshot/);
  });
});

describe('T-R56 — /admin/users reachability: renders the honest initial loading state', () => {
  test('mounts and shows a real, non-blank first paint', () => {
    const html = renderToStaticMarkup(createElement(AdminUsersPage));
    expect(html.length).toBeGreaterThan(0);
    expect(textOf(html)).toMatch(/Loading users/);
  });
});

describe('T-R56 — /admin/signups reachability: renders the honest initial loading state', () => {
  test('mounts and shows a real, non-blank first paint', () => {
    const html = renderToStaticMarkup(createElement(AdminSignupsActivityPage));
    expect(html.length).toBeGreaterThan(0);
    expect(textOf(html)).toMatch(/Loading recent signups/);
  });
});

describe('T-R56 — /admin/kill-switch reachability: renders honestly and calls the REAL existing endpoint', () => {
  test('mounts and shows a real, non-blank first paint', () => {
    const html = renderToStaticMarkup(createElement(AdminKillSwitchPage));
    expect(html.length).toBeGreaterThan(0);
    expect(textOf(html)).toMatch(/Loading kill switch status/);
  });

  test('never reimplements the kill-switch — calls the EXISTING /api/agents/kill-switch endpoint', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'admin', 'kill-switch', 'page.tsx'), 'utf8');
    expect(source).toMatch(/fetch\('\/api\/agents\/kill-switch'/);
    expect(source).toMatch(/scope: 'PLATFORM'/);
    expect(source).toMatch(/scope: 'ORG'/);
  });
});

describe('T-R56 — /admin/audit reachability: renders the honest initial loading state', () => {
  test('mounts and shows a real, non-blank first paint', () => {
    const html = renderToStaticMarkup(createElement(AdminAuditPage));
    expect(html.length).toBeGreaterThan(0);
    expect(textOf(html)).toMatch(/Loading/);
  });
});
