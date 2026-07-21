// T-57 R3c-1 (MAJOR-M3, master-spec §7.4 Memory Jogger). Before this fix, `MemoryJoggerService`
// (T-23) had ZERO HTTP surface anywhere in `src/app/api` — this proves the new route is real,
// session-gated, and wires the REAL Haiku-backed category client (never the local heuristic
// fallback the service otherwise defaults to). Mirrors the exact module-boundary-mocking
// convention established in tests/unit/agent-queue-route.test.ts.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    contact: { count: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));

const mockSelectNextCategory = jest.fn();
jest.mock('@/services/warm-market/memory-jogger', () => {
  const actual = jest.requireActual('@/services/warm-market/memory-jogger');
  return {
    ...actual,
    HaikuMemoryJoggerCategoryClient: jest.fn().mockImplementation(() => ({
      selectNextCategory: mockSelectNextCategory,
    })),
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { MissingClaudeCredentialError } from '@/services/warm-market/memory-jogger';
import { GET, POST } from '@/app/api/contacts/memory-jogger/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedContactCount = (prisma as unknown as { contact: { count: jest.Mock } }).contact.count;
const mockedContactFindMany = (prisma as unknown as { contact: { findMany: jest.Mock } }).contact.findMany;
const mockedContactCreate = (prisma as unknown as { contact: { create: jest.Mock } }).contact.create;

function fakeSession(): Session {
  return {
    user: {
      id: 'jogger-user-1',
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: 'org-1',
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function seedOnboarding(status: OnboardingStatus | null) {
  mockedUserFindUnique.mockResolvedValue(
    status === null ? null : { onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }] }
  );
}

function getRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/contacts/memory-jogger${query}`);
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/contacts/memory-jogger', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedContactCount.mockReset();
  mockedContactFindMany.mockReset();
  mockedContactCreate.mockReset();
  mockSelectNextCategory.mockReset();
});

describe('GET /api/contacts/memory-jogger — the §6.10-1 gate + §7.4 trigger rule', () => {
  test('no session -> 401, the category client never runs', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(401);
    expect(mockSelectNextCategory).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete -> 403 ONBOARDING_INCOMPLETE', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ONBOARDING_INCOMPLETE');
  });

  test('§7.4 "triggered when contact count is low (< 50)": 60 contacts + no onDemand -> trigger:false, no category call', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactCount.mockResolvedValue(60);
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ trigger: false, contactCount: 60, prompt: null });
    expect(mockSelectNextCategory).not.toHaveBeenCalled();
  });

  test('§7.4 "... or on demand": 60 contacts + ?onDemand=1 -> triggers anyway', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactCount.mockResolvedValue(60);
    mockSelectNextCategory.mockResolvedValue({ category: 'GATHERINGS', promptText: 'Who was at your last cookout?' });
    const res = await GET(getRequest('?onDemand=1'), {});
    const body = await res.json();
    expect(body.trigger).toBe(true);
    expect(body.prompt).toEqual({ category: 'GATHERINGS', promptText: 'Who was at your last cookout?' });
  });

  test('low contact count triggers WITHOUT onDemand, and calls the REAL Haiku category client (never the local heuristic)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactCount.mockResolvedValue(3);
    mockSelectNextCategory.mockResolvedValue({ category: 'NEIGHBORS', promptText: 'Which neighbor do you wave to?' });
    const res = await GET(getRequest(), {});
    const body = await res.json();
    expect(body.trigger).toBe(true);
    expect(body.contactCount).toBe(3);
    expect(body.prompt.category).toBe('NEIGHBORS');
    expect(mockSelectNextCategory).toHaveBeenCalledTimes(1);
  });

  test('FAIL-CLOSED, not fail-crash: a missing Claude credential -> 200 with prompt:null + unavailable reason, never a 500', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactCount.mockResolvedValue(3);
    mockSelectNextCategory.mockRejectedValue(new MissingClaudeCredentialError('ANTHROPIC_API_KEY'));
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ trigger: true, contactCount: 3, prompt: null, unavailable: 'no_key' });
  });

  test('an unrecognized `recent` category is filtered out (never forwarded as-is to the category client)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactCount.mockResolvedValue(3);
    mockSelectNextCategory.mockResolvedValue({ category: 'FITNESS', promptText: 'x' });
    await GET(getRequest('?recent=NOT_A_REAL_CATEGORY,GATHERINGS'), {});
    expect(mockSelectNextCategory).toHaveBeenCalledWith({ recentCategories: ['GATHERINGS'] });
  });
});

describe('POST /api/contacts/memory-jogger — §7.4 "new names search the Vault and add if absent"', () => {
  test('no session -> 401', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await POST(postRequest({ rawName: 'Alex' }), {});
    expect(res.status).toBe(401);
  });

  test('a blank rawName -> 400, no Vault write attempted', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await POST(postRequest({ rawName: '   ' }), {});
    expect(res.status).toBe(400);
    expect(mockedContactCreate).not.toHaveBeenCalled();
  });

  test('a genuinely new name -> outcome "added", a real Vault row created for the SESSION user (never a forged id)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindMany.mockResolvedValue([]);
    mockedContactCreate.mockResolvedValue({ id: 'new-contact-1' });
    const res = await POST(postRequest({ rawName: 'Priya Shah' }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ outcome: 'added', contactId: 'new-contact-1' });
    expect(mockedContactCreate).toHaveBeenCalledTimes(1);
    expect(mockedContactCreate.mock.calls[0][0].data.user_id).toBe('jogger-user-1');
  });
});
