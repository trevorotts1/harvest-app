// T-23 — proves `/api/contacts/agent-queue` (the §7.5 "contact pipeline to agents" route) is
// actually gated: no session → 401; authenticated but not GATED_COMPLETE → 403 ONBOARDING_INCOMPLETE;
// a forged `x-user-id` header has ZERO effect on either GET (queue read) or POST (outreach write) —
// the route only ever trusts the session-derived user id. Mirrors the exact module-boundary-mocking
// pattern already established in tests/unit/contacts-import-route.test.ts and
// tests/unit/wp01-onboarding-gate.test.ts: mock `@/lib/auth/session` + `@/lib/prisma`, then exercise
// the REAL `withOnboardingGate`-wrapped route handlers.
//
// `PipelineService`'s own correctness (decrypt, exclusion rules, ordering, recordOutreach) is proven
// independently in tests/unit/warm-market.test.ts against a real DI-mocked prisma — this suite
// proves ONLY the route/auth/ownership wiring: does the right (session-derived) user id reach
// PipelineService, and is a wrong caller (no session, incomplete onboarding, or someone else's
// contactId) denied before any read or write happens.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    contact: { findFirst: jest.fn() },
  },
}));

const mockGetAgentQueue = jest.fn();
const mockRecordOutreach = jest.fn();
jest.mock('@/services/warm-market/pipeline.service', () => {
  const actual = jest.requireActual('@/services/warm-market/pipeline.service');
  return {
    ...actual,
    PipelineService: jest.fn().mockImplementation(() => ({
      getAgentQueue: mockGetAgentQueue,
      recordOutreach: mockRecordOutreach,
    })),
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET, POST } from '@/app/api/contacts/agent-queue/route';
import { PipelineStage } from '@/types/warm-market';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedContactFindFirst = (prisma as unknown as { contact: { findFirst: jest.Mock } }).contact.findFirst;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-agentq-1',
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
  mockedUserFindUnique.mockResolvedValue(
    status === null ? null : { onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }] }
  );
}

function getRequest(query = '', headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/contacts/agent-queue${query}`, { headers });
}

function postRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/contacts/agent-queue', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedContactFindFirst.mockReset();
  mockGetAgentQueue.mockReset();
  mockRecordOutreach.mockReset();
});

describe('GET /api/contacts/agent-queue — the §6.10-1 hard gate + §7.5 typed contract', () => {
  test('no session → 401, PipelineService never runs', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(getRequest('?status=ready&limit=10'), {});
    expect(res.status).toBe(401);
    expect(mockGetAgentQueue).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete → 403 ONBOARDING_INCOMPLETE, PipelineService never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await GET(getRequest('?status=ready'), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(mockGetAgentQueue).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header has ZERO effect — the route uses the SESSION user id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockGetAgentQueue.mockResolvedValue([]);

    const res = await GET(getRequest('?status=ready&limit=10', { 'x-user-id': 'some-other-victim-id' }), {});

    expect(res.status).toBe(200);
    expect(mockGetAgentQueue).toHaveBeenCalledTimes(1);
    expect(mockGetAgentQueue.mock.calls[0][0]).toBe('real-session-user');
    expect(mockGetAgentQueue.mock.calls[0][0]).not.toBe('some-other-victim-id');
  });

  test('an unsupported status value → 400, PipelineService never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await GET(getRequest('?status=stale'), {});
    expect(res.status).toBe(400);
    expect(mockGetAgentQueue).not.toHaveBeenCalled();
  });

  test('GATED_COMPLETE + status=ready&limit=25 → 200 with the typed AgentQueueResult contract', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const contact = {
      id: 'contact-1',
      firstName: 'Sarah',
      lastName: 'Vega',
      phone: null,
      email: null,
      relationshipType: null,
      segmentScore: 90,
      isAList: true,
      isRecruitTarget: false,
      isClient: false,
      pipelineStage: PipelineStage.IDENTIFIED,
      lastContactDate: null,
      doNotContact: false,
    };
    mockGetAgentQueue.mockResolvedValue([contact]);

    const res = await GET(getRequest('?status=ready&limit=25'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ready', limit: 25, count: 1, contacts: [contact] });
    expect(mockGetAgentQueue).toHaveBeenCalledWith('user-agentq-1', { status: 'ready', limit: 25 });
  });

  test('an out-of-range limit is clamped to AGENT_QUEUE_MAX_LIMIT (200)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockGetAgentQueue.mockResolvedValue([]);

    const res = await GET(getRequest('?status=ready&limit=999999'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(200);
    expect(mockGetAgentQueue).toHaveBeenCalledWith('user-agentq-1', { status: 'ready', limit: 200 });
  });
});

describe('POST /api/contacts/agent-queue — §7.5 "after outreach it updates last_contact_date and pipeline_stage"', () => {
  test('no session → 401, never touches prisma or PipelineService', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await POST(postRequest({ contactId: 'c1', toStage: PipelineStage.RESPONDED }), {});
    expect(res.status).toBe(401);
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
    expect(mockRecordOutreach).not.toHaveBeenCalled();
  });

  test('missing contactId → 400, never reaches prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await POST(postRequest({ toStage: PipelineStage.RESPONDED }), {});
    expect(res.status).toBe(400);
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
  });

  test('invalid toStage → 400, never reaches prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await POST(postRequest({ contactId: 'c1', toStage: 'NOT_A_REAL_STAGE' }), {});
    expect(res.status).toBe(400);
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
  });

  test('a contactId NOT owned by the session user → 404, recordOutreach never runs (per-rep isolation, §3.4)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindFirst.mockResolvedValue(null); // not found for this user_id

    const res = await POST(
      postRequest({ contactId: 'someone-elses-contact', toStage: PipelineStage.RESPONDED }),
      {}
    );

    expect(res.status).toBe(404);
    expect(mockedContactFindFirst).toHaveBeenCalledWith({
      where: { id: 'someone-elses-contact', user_id: 'real-session-user' },
    });
    expect(mockRecordOutreach).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header cannot be used to write another rep\'s contact — ownership check uses the SESSION id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindFirst.mockResolvedValue(null);

    const res = await POST(
      postRequest(
        { contactId: 'victim-contact', toStage: PipelineStage.RESPONDED },
        { 'x-user-id': 'some-other-victim-id' }
      ),
      {}
    );

    expect(res.status).toBe(404);
    expect(mockedContactFindFirst).toHaveBeenCalledWith({
      where: { id: 'victim-contact', user_id: 'real-session-user' },
    });
  });

  test('an owned contact + valid toStage → 200, recordOutreach runs with the right args', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindFirst.mockResolvedValue({ id: 'my-contact-1', user_id: 'real-session-user' });
    mockRecordOutreach.mockResolvedValue({
      id: 'my-contact-1',
      pipeline_stage: PipelineStage.RESPONDED,
      last_contact_date: new Date('2026-07-17T00:00:00Z'),
    });

    const res = await POST(
      postRequest({ contactId: 'my-contact-1', toStage: PipelineStage.RESPONDED, contactedAt: '2026-07-17T00:00:00Z' }),
      {}
    );

    expect(res.status).toBe(200);
    expect(mockRecordOutreach).toHaveBeenCalledWith({
      contactId: 'my-contact-1',
      toStage: PipelineStage.RESPONDED,
      contactedAt: new Date('2026-07-17T00:00:00Z'),
    });
    const body = await res.json();
    expect(body.pipelineStage).toBe(PipelineStage.RESPONDED);
  });
});
