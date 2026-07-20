// T-R22 / T-R22R (remediation of the T-40R re-QC LOW/UX finding: POST /api/messaging/handoff/join
// was API-reachable ONLY, with no upline-facing UI to even see a pending bridge) — proves the NEW
// GET /api/messaging/handoff/pending read route (the read T-R22 adds so `/team` has something real
// to render) is session-gated, reads no forged identity, and is strictly org/upline scoped by
// RE-DERIVING the caller's own organization from the database (never a client-supplied param)
// before handing it to the pre-existing, unmodified `ThreeWayHandoffService.visibleToUpline`
// (already proven org/upline-scoped at the service layer in three-way-handoff.service.test.ts — this
// suite proves the ROUTE never lets a caller widen or spoof that scope, and shapes a correct,
// contact-PII-free response).
//
// Carried over UNMODIFIED from build/T-R22-handoff-join-ui@765c793 as part of the T-R22R
// re-integration onto WP09's `/team` surface: this route was re-created byte-for-byte at
// src/app/api/messaging/handoff/pending/route.ts (WP09 never touched it), so this suite needed no
// adaptation — only its consumer moved, from the bare `/team` page to `/team/bridges`.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}));

const mockVisibleToUpline = jest.fn();
jest.mock('@/services/messaging/handoff/three-way-handoff.service', () => {
  const actual = jest.requireActual('@/services/messaging/handoff/three-way-handoff.service');
  return {
    ...actual,
    ThreeWayHandoffService: jest.fn().mockImplementation(() => ({
      visibleToUpline: mockVisibleToUpline,
    })),
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/messaging/handoff/pending/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedUserFindMany = (prisma as unknown as { user: { findMany: jest.Mock } }).user.findMany;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'upline-1',
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: 'org-token-stale', // deliberately DIFFERENT from the DB row below — the route
      // must use the live DB read, never this token claim, for the org gate.
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function seedOnboarding(status: OnboardingStatus | null, organizationId: string | null = 'org-live-1') {
  mockedUserFindUnique.mockResolvedValue(
    status === null
      ? null
      : { onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }], organization_id: organizationId }
  );
}

function getRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/messaging/handoff/pending', { headers });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedUserFindMany.mockReset();
  mockVisibleToUpline.mockReset();
});

describe('GET /api/messaging/handoff/pending — T-R22 session-gated, org-scoped, no leak', () => {
  test('no session → 401, the service is never queried', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(401);
    expect(mockVisibleToUpline).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete → 403 ONBOARDING_INCOMPLETE, service never queried', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    // withOnboardingGate's own DB read only selects onboarding_status/onboarding_sessions — mimic
    // that shape (no organization_id key) since the gate itself never sees this route's later read.
    mockedUserFindUnique.mockResolvedValue({
      onboarding_status: OnboardingStatus.IN_PROGRESS,
      onboarding_sessions: [{ current_step: 'REGISTER' }],
    });
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(mockVisibleToUpline).not.toHaveBeenCalled();
  });

  // withOnboardingGate calls prisma.user.findUnique ONCE (for onboarding state); the route handler
  // itself calls it a SECOND time (for organization_id). Both must resolve for a gated-complete
  // caller, so this helper wires findUnique to answer both shapes correctly by call order.
  function seedGatedComplete(organizationId: string | null) {
    mockedUserFindUnique.mockImplementation((args: { select?: Record<string, unknown> }) => {
      if (args?.select && 'onboarding_status' in args.select) {
        return Promise.resolve({ onboarding_status: OnboardingStatus.GATED_COMPLETE, onboarding_sessions: [] });
      }
      return Promise.resolve(organizationId === null ? { organization_id: null } : { organization_id: organizationId });
    });
  }

  test('the caller has NO organization on file → 200 empty list, the service is never queried (fail closed)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'upline-1' }));
    seedGatedComplete(null);

    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ count: 0, items: [] });
    expect(mockVisibleToUpline).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header has ZERO effect — the service is queried with the SESSION user id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-upline' }));
    seedGatedComplete('org-live-1');
    mockVisibleToUpline.mockResolvedValue([]);

    const res = await GET(getRequest({ 'x-user-id': 'some-other-victim-id' }), {});

    expect(res.status).toBe(200);
    expect(mockVisibleToUpline).toHaveBeenCalledTimes(1);
    expect(mockVisibleToUpline).toHaveBeenCalledWith('real-upline', 'org-live-1');
  });

  test('OWNERSHIP: the LIVE DB organization_id is used, never the (deliberately different) session-token claim', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'upline-1', organizationId: 'org-token-stale' }));
    seedGatedComplete('org-live-1');
    mockVisibleToUpline.mockResolvedValue([]);

    await GET(getRequest(), {});

    expect(mockVisibleToUpline).toHaveBeenCalledWith('upline-1', 'org-live-1');
    expect(mockVisibleToUpline).not.toHaveBeenCalledWith('upline-1', 'org-token-stale');
  });

  test('happy path: only INVITED rows are returned, hydrated with the inviting rep name, never contact PII', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'upline-1' }));
    seedGatedComplete('org-live-1');
    mockVisibleToUpline.mockResolvedValue([
      {
        id: 'handoff-1',
        user_id: 'rep-A',
        upline_id: 'upline-1',
        organization_id: 'org-live-1',
        contact_id: 'contact-secret-77',
        thread_id: null,
        trigger_reason: 'BUYING_SIGNAL',
        state: 'INVITED',
        invited_at: new Date('2026-07-15T12:00:00Z'),
        joined_at: null,
        returned_at: null,
        return_deadline_at: new Date('2026-07-16T12:00:00Z'),
        coached_next_step: null,
      },
      {
        id: 'handoff-2',
        user_id: 'rep-B',
        upline_id: 'upline-1',
        organization_id: 'org-live-1',
        contact_id: 'contact-other',
        thread_id: null,
        trigger_reason: 'HARD_QUESTION',
        state: 'JOINED', // already joined — must NOT appear in the pending list
        invited_at: new Date('2026-07-14T12:00:00Z'),
        joined_at: new Date('2026-07-14T13:00:00Z'),
        returned_at: null,
        return_deadline_at: new Date('2026-07-15T12:00:00Z'),
        coached_next_step: null,
      },
    ]);
    mockedUserFindMany.mockResolvedValue([{ id: 'rep-A', name: 'Priya Nair' }]);

    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.count).toBe(1);
    expect(body.items).toEqual([
      {
        id: 'handoff-1',
        repName: 'Priya Nair',
        triggerReason: 'BUYING_SIGNAL',
        invitedAt: '2026-07-15T12:00:00.000Z',
        returnDeadlineAt: '2026-07-16T12:00:00.000Z',
      },
    ]);
    // Never the contact id anywhere in the payload — pre-join, this is "who is asking", never
    // "who they're talking to" (§2.5).
    expect(JSON.stringify(body)).not.toContain('contact-secret-77');
    expect(mockedUserFindMany).toHaveBeenCalledWith({ where: { id: { in: ['rep-A'] } }, select: { id: true, name: true } });
  });

  test('a rep whose inviting-rep name lookup comes back empty still gets a safe fallback label', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'upline-1' }));
    seedGatedComplete('org-live-1');
    mockVisibleToUpline.mockResolvedValue([
      {
        id: 'handoff-9',
        user_id: 'rep-deleted',
        upline_id: 'upline-1',
        organization_id: 'org-live-1',
        contact_id: 'c-9',
        thread_id: null,
        trigger_reason: 'MANUAL',
        state: 'INVITED',
        invited_at: new Date('2026-07-15T12:00:00Z'),
        joined_at: null,
        returned_at: null,
        return_deadline_at: new Date('2026-07-16T12:00:00Z'),
        coached_next_step: null,
      },
    ]);
    mockedUserFindMany.mockResolvedValue([]); // the rep row is gone

    const res = await GET(getRequest(), {});
    const body = await res.json();
    expect(body.items[0].repName).toBe('A rep on your team');
  });
});
