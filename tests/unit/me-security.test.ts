// T-57 R3b (E-M10 + §16.4 sign-out-everywhere) — Me -> Security: the new `/api/auth/mfa/status`
// read route + the page that (a) reuses the REAL `/api/auth/mfa/enroll`/`verify` lifecycle
// (never a second MFA implementation — the same two routes `OrgSwitchPanel.tsx` and data-rights'
// `useStepUpAction` already use) and (b) wires "sign out everywhere" to the REAL
// `/api/auth/session/revoke-all` contract, which requires the CURRENT PASSWORD, not a step-up MFA
// challenge (see that route's own header comment — this is deliberately verified below so the UI
// never drifts from the real contract into a fabricated step-up flow).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Role } from '@prisma/client';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET as mfaStatusGet } from '@/app/api/auth/mfa/status/route';
import SecurityPage from '@/app/me/security/page';
import { t as catalog } from '@/lib/i18n/catalog';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;

const REPO_ROOT = path.join(__dirname, '..', '..');
const src = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, 'src', ...parts), 'utf8');

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-sec-1',
      role: Role.UPLINE,
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

function statusReq(): NextRequest {
  return new NextRequest('http://localhost/api/auth/mfa/status', { method: 'GET' });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
});

describe('GET /api/auth/mfa/status — a fresh, DB-backed enrollment read (E-M10)', () => {
  test('no session -> 401', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await mfaStatusGet(statusReq(), {});
    expect(res.status).toBe(401);
  });

  test('reads the LIVE DB value, not the (possibly stale) session JWT claim', async () => {
    // The session claims mfaEnrolled:false (as it would be for the rest of THIS session's life —
    // options.ts never refreshes that claim on `update()`), but the DB already says true (e.g. the
    // rep just enrolled moments ago on this very page) — the route must report the DB truth.
    mockedSession.mockResolvedValue(fakeSession({ id: 'u-2', mfaEnrolled: false }));
    mockedUserFindUnique.mockResolvedValue({ mfa_enrolled: true });

    const res = await mfaStatusGet(statusReq(), {});
    expect(res.status).toBe(200);
    expect((await res.json()).enrolled).toBe(true);
    expect(mockedUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-2' } })
    );
  });

  test('an upline/RVP/admin who never enrolled shows enrolled:false (the reachability gap this build closes)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'u-3', role: Role.RVP }));
    mockedUserFindUnique.mockResolvedValue({ mfa_enrolled: false });
    const res = await mfaStatusGet(statusReq(), {});
    expect((await res.json()).enrolled).toBe(false);
  });
});

describe('Me -> Security page: MFA enrollment reuses the REAL lifecycle, never a duplicate implementation', () => {
  test('enroll/verify hit the exact same routes OrgSwitchPanel / data-rights already use', () => {
    const page = src('app', 'me', 'security', 'page.tsx');
    expect(page).toContain("fetch('/api/auth/mfa/enroll'");
    expect(page).toContain("fetch('/api/auth/mfa/verify'");
    expect(page).toContain("fetch('/api/auth/mfa/status')");
  });

  test('displays the one-time recovery codes from the enroll response (a real content gap neither existing consumer surfaced)', () => {
    const page = src('app', 'me', 'security', 'page.tsx');
    expect(page).toContain('enrollment.recoveryCodes.map');
    expect(page).toContain('me.security.mfa.recoveryCodesIntro');
  });

  test('never calls /api/auth/mfa/step-up for plain enrollment (first-time enrollment needs no step-up)', () => {
    const page = src('app', 'me', 'security', 'page.tsx');
    expect(page).not.toContain('mfa/step-up');
  });
});

describe('Me -> Security page: "sign out everywhere" matches the REAL revoke-all contract (password, not MFA)', () => {
  test('POSTs to /api/auth/session/revoke-all with a password field — the real request shape', () => {
    const page = src('app', 'me', 'security', 'page.tsx');
    expect(page).toContain("fetch('/api/auth/session/revoke-all'");
    expect(page).toMatch(/method: 'POST'/);
    expect(page).toContain('JSON.stringify({ password })');
  });

  test('handles 401 (incorrect password) distinctly from a generic failure', () => {
    const page = src('app', 'me', 'security', 'page.tsx');
    expect(page).toContain('res.status === 401');
    expect(page).toContain('me.security.signOutEverywhere.incorrectPassword');
  });

  test('ends the current session too on success (next-auth signOut) — never leaves the rep looking signed-in after claiming "everywhere"', () => {
    const page = src('app', 'me', 'security', 'page.tsx');
    expect(page).toContain("import { signOut } from 'next-auth/react'");
    expect(page).toContain('await signOut(');
  });

  test('the password input is type="password" with autocomplete hint (never a plaintext field)', () => {
    const page = src('app', 'me', 'security', 'page.tsx');
    expect(page).toMatch(/type="password"[\s\S]{0,200}autoComplete="current-password"/);
  });
});

describe('Me -> Security page: rendering + catalog', () => {
  test('renders the deterministic MFA loading state', () => {
    const html = renderToStaticMarkup(createElement(SecurityPage, {}));
    expect(html.replace(/<[^>]*>/g, ' ')).toContain('Checking your two-factor status');
  });

  test('every me.security.* key used resolves to distinct, real EN/ES copy', () => {
    const keys = [
      'me.security.hubTitle',
      'me.security.heading',
      'me.security.mfa.sectionTitle',
      'me.security.mfa.statusOn',
      'me.security.mfa.statusOff',
      'me.security.mfa.startEnrollCta',
      'me.security.mfa.recoveryCodesIntro',
      'me.security.signOutEverywhere.sectionTitle',
      'me.security.signOutEverywhere.body',
      'me.security.signOutEverywhere.cta',
      'me.security.signOutEverywhere.incorrectPassword',
    ];
    for (const key of keys) {
      const en = catalog('en', key);
      const es = catalog('es', key);
      expect(en).not.toBe(key);
      expect(es).not.toBe(key);
      expect(es).not.toBe(en);
    }
  });
});
