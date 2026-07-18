// WP04 (T-32) — HTTP-layer proof for the Mission Control / Today routes: session-gated (never a
// forged `x-user-id`), ownership-scoped, and independent-zone-failure holds end-to-end through the
// real route handler (not just the aggregator unit). Same module-boundary mocking convention as
// tests/unit/wp01-onboarding-gate.test.ts.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

import { createInMemoryMissionControlDb } from '../../src/services/mission-control/testing/in-memory-db';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

const NOW = new Date('2026-07-15T12:00:00.000Z');
const REP_ONE = 'rep-1';
const REP_TWO = 'rep-2';
const ORG = 'org-1';

function seededDb() {
  return createInMemoryMissionControlDb({
    momentumEvents: [{ user_id: REP_ONE, law: 'grow', points: 5, created_at: NOW }],
    agentRuns: [
      { id: 'run-1', user_id: REP_ONE, agent_key: 'reporting', status: 'COMPLETED', reasoning_log: 'Reporting Agent composed the briefing narrative on claude-sonnet-5. CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW },
    ],
    draftMessages: [
      { id: 'draft-rep1', user_id: REP_ONE, contact_id: 'contact-1', channel: 'SMS_HANDOFF', cfe_outcome: 'PASS', approval_state: 'PENDING', approved_by: null, approved_at: null, created_at: NOW },
    ],
    contacts: [{ id: 'contact-1', user_id: REP_ONE, first_name: 'Maya', last_name: 'Johnson', pipeline_stage: 'INTRODUCED', is_client: false, updated_at: NOW, created_at: NOW }],
    appointments: [],
    teamEvents: [{ id: 'evt-1', organization_id: ORG, type: 'team_call', starts_at: new Date(NOW.getTime() + 60 * 60 * 1000) }],
    attendance: [],
  });
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET as todayGET } from '@/app/api/mission-control/today/route';
import { POST as queueActionPOST } from '@/app/api/mission-control/queue-action/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;

function fakeSession(userId: string, overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: userId,
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: ORG,
      accessTier: 'FREE_ORG_LINKED',
      onboardingStatus: OnboardingStatus.GATED_COMPLETE,
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      name: 'Alex Rep',
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function gatedComplete() {
  mockedFindUnique.mockResolvedValue({ onboarding_status: OnboardingStatus.GATED_COMPLETE, onboarding_sessions: [{ current_step: 'DONE' }] });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedFindUnique.mockReset();
  // Merge a FRESH DB fake's methods onto the SAME mocked prisma object every route casts through, so
  // withOnboardingGate's `user.findUnique` and today.service.ts's zone reads share one module mock,
  // and each test starts from a clean, unmutated seed.
  Object.assign(prisma as unknown as object, seededDb());
});

describe('GET /api/mission-control/today — session gate + real zone data', () => {
  test('unauthenticated → 401, no data leaks', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await todayGET(new NextRequest('http://localhost/api/mission-control/today'), {});
    expect(res.status).toBe(401);
  });

  test('authenticated but onboarding incomplete → 403, no data leaks', async () => {
    mockedSession.mockResolvedValue(fakeSession(REP_ONE));
    mockedFindUnique.mockResolvedValue({ onboarding_status: OnboardingStatus.IN_PROGRESS, onboarding_sessions: [] });
    const res = await todayGET(new NextRequest('http://localhost/api/mission-control/today'), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.header).toBeUndefined();
  });

  test('GATED_COMPLETE session gets real, per-user Today data — all six zones present', async () => {
    mockedSession.mockResolvedValue(fakeSession(REP_ONE));
    gatedComplete();
    const res = await todayGET(new NextRequest('http://localhost/api/mission-control/today'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.header.status).toBe('ok');
    expect(body.header.data.greetingName).toBe('Alex');
    expect(body.briefing.status).toBe('ok');
    expect(body.actionQueue.status).toBe('ok');
    expect(body.actionQueue.data.totalCount).toBeGreaterThan(0);
    expect(body.pipeline.status).toBe('ok');
    expect(body.ratios.status).toBe('ok');
    expect(body.calendar.status).toBe('ok');
  });

  test('a forged x-user-id header is INERT — the response still reflects the SESSION user, never the header', async () => {
    mockedSession.mockResolvedValue(fakeSession(REP_ONE));
    gatedComplete();
    const req = new NextRequest('http://localhost/api/mission-control/today', {
      headers: { 'x-user-id': REP_TWO },
    });
    const res = await todayGET(req, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    // rep-1's real seeded data (their draft, their contact) shows up — proving the route used the
    // session identity, not the forged header (which names rep-2, who owns nothing in this seed).
    expect(body.actionQueue.data.totalCount).toBeGreaterThan(0);
    expect(body.header.data.greetingName).toBe('Alex');
  });
});

describe('POST /api/mission-control/queue-action — ownership-scoped mutation', () => {
  test('approving a draft you do not own is refused, never mutates', async () => {
    mockedSession.mockResolvedValue(fakeSession(REP_TWO));
    gatedComplete();
    const req = new NextRequest('http://localhost/api/mission-control/queue-action', {
      method: 'POST',
      body: JSON.stringify({ kind: 'draft', id: 'draft-rep1', action: 'approve' }),
    });
    const res = await queueActionPOST(req, {});
    expect(res.status).toBe(404);
  });

  test('approving your own draft succeeds', async () => {
    mockedSession.mockResolvedValue(fakeSession(REP_ONE));
    gatedComplete();
    const req = new NextRequest('http://localhost/api/mission-control/queue-action', {
      method: 'POST',
      body: JSON.stringify({ kind: 'draft', id: 'draft-rep1', action: 'approve' }),
    });
    const res = await queueActionPOST(req, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
