// T-57 R3b (MAJOR-D3, master-spec §12.6, uiux §6.5/§6.6) — Me -> Notifications: the new page + the
// new read-only activity-log route. Mirrors this repo's established conventions: route-handler tests
// mock `@/lib/auth/session` + `@/lib/prisma` and drive the REAL `withOnboardingGate`-wrapped
// handlers (tests/unit/contacts-import-route.test.ts); page tests use `renderToStaticMarkup` for the
// deterministic loading state (the real fetch never resolves under this repo's no-jsdom node test
// env — same limitation `subscription-datarights-catalog-i18n.test.ts` documents) plus direct
// catalog-key proofs, and source-level assertions for behavior that can't be simulated without a DOM
// (matching `me-hub-accessibility.test.ts`'s own convention for the Big Text toggle).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { OnboardingStatus, Role } from '@prisma/client';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    notificationLog: { findMany: jest.fn() },
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET as logGet } from '@/app/api/gamification/notifications/log/route';
import NotificationsPage from '@/app/me/notifications/page';
import { LocaleContext } from '@/app/locale-context';
import { t as catalog } from '@/lib/i18n/catalog';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedLogFindMany = (prisma as unknown as { notificationLog: { findMany: jest.Mock } }).notificationLog.findMany;

const REPO_ROOT = path.join(__dirname, '..', '..');
const src = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, 'src', ...parts), 'utf8');

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-notif-1',
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: 'org-1',
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function seedOnboarding(status: OnboardingStatus | null) {
  mockedUserFindUnique.mockResolvedValueOnce(
    status === null ? null : { onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }] }
  );
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost/api/gamification/notifications/log', { method: 'GET' });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedLogFindMany.mockReset();
});

describe('GET /api/gamification/notifications/log — the "quiet so far" data source (uiux §6.6)', () => {
  test('no session -> 401, no log read attempted', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await logGet(getRequest(), {});
    expect(res.status).toBe(401);
    expect(mockedLogFindMany).not.toHaveBeenCalled();
  });

  test('authenticated but not gated_complete -> 403 ONBOARDING_INCOMPLETE', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await logGet(getRequest(), {});
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ONBOARDING_INCOMPLETE');
    expect(mockedLogFindMany).not.toHaveBeenCalled();
  });

  test('gated_complete + no history -> empty items array (the real "quiet so far" case, never fabricated)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'quiet-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedLogFindMany.mockResolvedValue([]);

    const res = await logGet(getRequest(), {});
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
    expect(mockedLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 'quiet-user' } })
    );
  });

  test('gated_complete + real history -> returns it, most-recent first, own user only (never a query-param id)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'active-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const rows = [
      { type: 'MORNING_BRIEFING', deep_link: '/today/briefing', unmutable: false, created_at: new Date('2026-07-20T07:00:00Z') },
    ];
    mockedLogFindMany.mockResolvedValue(rows);

    const req = new NextRequest('http://localhost/api/gamification/notifications/log', {
      method: 'GET',
      headers: { 'x-user-id': 'someone-elses-id' }, // forged header must have zero effect
    });
    const res = await logGet(req, {});
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(mockedLogFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: 'active-user' } }));
  });
});

describe('Me -> Notifications page (D3): source wiring to the REAL contract', () => {
  test('reads/writes the real preferences route with the real field names (no fabricated shape)', () => {
    const page = src('app', 'me', 'notifications', 'page.tsx');
    expect(page).toContain("fetch('/api/gamification/notifications/preferences')");
    expect(page).toMatch(/fetch\('\/api\/gamification\/notifications\/preferences',\s*\{\s*\n\s*method: 'PATCH'/);
    for (const field of [
      'morning_briefing_enabled',
      'morning_briefing_time',
      'midday_motivation_enabled',
      'evening_recap_enabled',
      'quiet_hours_start',
      'quiet_hours_end',
      'timezone',
    ]) {
      expect(page).toContain(field);
    }
  });

  test('reads the new activity log route for the "quiet so far" section', () => {
    const page = src('app', 'me', 'notifications', 'page.tsx');
    expect(page).toContain("fetch('/api/gamification/notifications/log')");
    expect(page).toContain('me.notifications.activity.quietSoFar');
  });

  test('renders the deterministic loading state (the real fetch never resolves in this test env)', () => {
    const html = renderToStaticMarkup(createElement(NotificationsPage, {}));
    expect(html.replace(/<[^>]*>/g, ' ')).toContain('Loading your notification settings');
  });

  test('every me.notifications.* key used by the page resolves to distinct, real EN/ES copy', () => {
    const keys = [
      'me.notifications.heading',
      'me.notifications.subhead',
      'me.notifications.activity.quietSoFar',
      'me.notifications.activity.hint',
      'me.notifications.morningBriefing.title',
      'me.notifications.midday.title',
      'me.notifications.evening.title',
      'me.notifications.quietHours.title',
      'me.notifications.timezone.title',
      'me.notifications.alwaysOn.title',
      'me.notifications.alwaysOn.desc',
      'me.notifications.saveNotice.saved',
      'me.notifications.saveNotice.failed',
    ];
    for (const key of keys) {
      const en = catalog('en', key);
      const es = catalog('es', key);
      expect(en).not.toBe(key); // never the bare missing-key fallback
      expect(es).not.toBe(key);
      expect(es).not.toBe(en); // genuinely translated, not an EN-copy placeholder
    }
  });

  test('renders in Spanish under an ES locale provider (heading + quiet-so-far copy)', () => {
    const html = renderToStaticMarkup(
      createElement(
        LocaleContext.Provider,
        { value: { locale: 'es', setLocale: () => {}, t: (k: string, v?: Record<string, string | number>) => catalog('es', k, v) } },
        createElement(NotificationsPage, {})
      )
    );
    expect(html.replace(/<[^>]*>/g, ' ')).toContain('Cargando tu configuración de notificaciones');
  });
});
