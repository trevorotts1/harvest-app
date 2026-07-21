// T-57 R3b (E-M4, master-spec §4.5/§4.6, uiux §4.9) — Me -> Intensity: the new
// `/api/settings/intensity` route + the page that reuses the REAL onboarding `IntensityDial`
// component (never a second implementation). Route tests mirror
// tests/unit/contacts-import-route.test.ts's withOnboardingGate-mocking convention; page tests use
// renderToStaticMarkup for the deterministic loading state + source-level proofs for the
// effective-immediately PATCH wiring (the real fetch never resolves in this repo's no-jsdom node
// test env).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { IntensitySetting, OnboardingStatus, Role } from '@prisma/client';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn(), update: jest.fn() } },
}));

// `IntensityPage` calls `useRouter()` at render time (for the dial's repurposed "back to Me" CTA);
// outside a mounted app router (this repo's Jest env is plain `testEnvironment: 'node'`, no App
// Router — jest.config.js) that hook throws. Mocked purely to make a static render possible, same
// convention tests/unit/auth-page-i18n.test.ts already established for AuthPage's own useRouter().
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET as intensityGet, PATCH as intensityPatch } from '@/app/api/settings/intensity/route';
import IntensityPage from '@/app/me/intensity/page';
import { t as catalog } from '@/lib/i18n/catalog';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedUserUpdate = (prisma as unknown as { user: { update: jest.Mock } }).user.update;

const REPO_ROOT = path.join(__dirname, '..', '..');
const src = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, 'src', ...parts), 'utf8');

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-intensity-1',
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

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/settings/intensity', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedUserUpdate.mockReset();
});

describe('GET/PATCH /api/settings/intensity — the missing post-onboarding write path (uiux §4.9)', () => {
  test('GET: no session -> 401', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await intensityGet(req('GET'), {});
    expect(res.status).toBe(401);
  });

  test('GET: not gated_complete -> 403 ONBOARDING_INCOMPLETE', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await intensityGet(req('GET'), {});
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ONBOARDING_INCOMPLETE');
  });

  test('GET: gated_complete -> returns the real stored value', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'u-1' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedUserFindUnique.mockResolvedValueOnce({ intensity_setting: IntensitySetting.HIGH });
    const res = await intensityGet(req('GET'), {});
    expect(res.status).toBe(200);
    expect((await res.json()).intensity_setting).toBe('HIGH');
  });

  test('GET: defaults to MEDIUM if the row is somehow missing (never blank/undefined)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'u-1' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedUserFindUnique.mockResolvedValueOnce(null);
    const res = await intensityGet(req('GET'), {});
    expect((await res.json()).intensity_setting).toBe('MEDIUM');
  });

  test('PATCH: rejects a non-enum value with 400, never touches the DB', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'u-1' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await intensityPatch(req('PATCH', { intensity_setting: 'EXTREME' }), {});
    expect(res.status).toBe(400);
    expect(mockedUserUpdate).not.toHaveBeenCalled();
  });

  test('PATCH: a valid value persists immediately, scoped to the session user id (never a body-supplied id)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'the-real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedUserUpdate.mockResolvedValue({});

    const res = await intensityPatch(req('PATCH', { intensity_setting: 'LOW', user_id: 'someone-else' }), {});
    expect(res.status).toBe(200);
    expect((await res.json()).intensity_setting).toBe('LOW');
    expect(mockedUserUpdate).toHaveBeenCalledWith({
      where: { id: 'the-real-session-user' },
      data: { intensity_setting: 'LOW' },
    });
  });
});

describe('Me -> Intensity page (E-M4): reuses the REAL onboarding IntensityDial, never a duplicate', () => {
  test('imports the real onboarding component (not a re-implementation)', () => {
    const page = src('app', 'me', 'intensity', 'page.tsx');
    expect(page).toContain("import IntensityDial from '@/app/onboarding/components/IntensityDial'");
  });

  test('wires the "effective immediately" PATCH to the new route with the real field name', () => {
    const page = src('app', 'me', 'intensity', 'page.tsx');
    expect(page).toContain("fetch('/api/settings/intensity'");
    expect(page).toMatch(/method: 'PATCH'/);
    expect(page).toContain('intensity_setting: next');
  });

  test('renders the deterministic loading state', () => {
    const html = renderToStaticMarkup(createElement(IntensityPage, {}));
    expect(html.replace(/<[^>]*>/g, ' ')).toContain('Loading your intensity setting');
  });

  test('every me.intensity.* key resolves to distinct, real EN/ES copy', () => {
    const keys = ['me.intensity.hubTitle', 'me.intensity.heading', 'me.intensity.subhead', 'me.intensity.saveNotice.saved', 'me.intensity.saveNotice.failed'];
    for (const key of keys) {
      const en = catalog('en', key);
      const es = catalog('es', key);
      expect(en).not.toBe(key);
      expect(es).not.toBe(key);
      expect(es).not.toBe(en);
    }
  });
});
