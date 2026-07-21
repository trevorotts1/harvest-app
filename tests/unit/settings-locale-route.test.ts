// T-53 — GET/PATCH /api/settings/locale (Me -> Language persistence, master-spec §17.5 / uiux
// §6.2). Session-gated (any authenticated role, no step-up — a display-language preference has no
// compliance weight, unlike org_switch); validates the body against `isLocale()`; always reads/
// writes the LIVE session user id, never a client-forged header. Same mock convention as
// tests/unit/contact-flags.test.ts's route-level suite.
import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn(), update: jest.fn() } },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET, PATCH } from '@/app/api/settings/locale/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedUpdate = (prisma as unknown as { user: { update: jest.Mock } }).user.update;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'real-session-user',
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

function getRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/settings/locale', { headers });
}

function patchRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/settings/locale', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedFindUnique.mockReset();
  mockedUpdate.mockReset();
});

describe('GET /api/settings/locale', () => {
  test('no session -> 401, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(401);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  test('signed-in rep with a persisted preference -> 200 { locale }, reads by the REAL session id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'user-abc' }));
    mockedFindUnique.mockResolvedValue({ locale: 'es' });

    const res = await GET(getRequest({ 'x-user-id': 'someone-else' }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ locale: 'es' });
    expect(mockedFindUnique).toHaveBeenCalledWith({ where: { id: 'user-abc' }, select: { locale: true } });
  });

  test('a forged x-user-id header has ZERO effect — the session id is always what is queried', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-user' }));
    mockedFindUnique.mockResolvedValue({ locale: 'en' });

    await GET(getRequest({ 'x-user-id': 'attacker-controlled-id' }), {});
    expect(mockedFindUnique).toHaveBeenCalledWith({ where: { id: 'real-user' }, select: { locale: true } });
  });

  test('no persisted preference (locale null in DB) -> 200 { locale: null } — never blank/undefined, a real null the client can fall back from', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockedFindUnique.mockResolvedValue({ locale: null });

    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: null });
  });

  test('user row not found -> still 200 { locale: null }, never throws/500', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockedFindUnique.mockResolvedValue(null);

    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: null });
  });
});

describe('PATCH /api/settings/locale', () => {
  test('no session -> 401, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ locale: 'es' }), {});
    expect(res.status).toBe(401);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  test('valid "es" -> 200, writes to the REAL session user id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'user-xyz' }));
    mockedUpdate.mockResolvedValue({});

    const res = await PATCH(patchRequest({ locale: 'es' }), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, locale: 'es' });
    expect(mockedUpdate).toHaveBeenCalledWith({ where: { id: 'user-xyz' }, data: { locale: 'es' } });
  });

  test('valid "en" -> 200, writes correctly', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockedUpdate.mockResolvedValue({});

    const res = await PATCH(patchRequest({ locale: 'en' }), {});
    expect(res.status).toBe(200);
    expect(mockedUpdate).toHaveBeenCalledWith({ where: { id: 'real-session-user' }, data: { locale: 'en' } });
  });

  test('an unsupported locale (e.g. "fr") -> 400, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await PATCH(patchRequest({ locale: 'fr' }), {});
    expect(res.status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  test('a missing/malformed body -> 400, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await PATCH(patchRequest({}), {});
    expect(res.status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header has ZERO effect on which row is written', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-user' }));
    mockedUpdate.mockResolvedValue({});

    await PATCH(patchRequest({ locale: 'es' }, { 'x-user-id': 'attacker-controlled-id' }), {});
    expect(mockedUpdate).toHaveBeenCalledWith({ where: { id: 'real-user' }, data: { locale: 'es' } });
  });
});
