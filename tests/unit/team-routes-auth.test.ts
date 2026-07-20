// T-R24 (test-coverage hardening from the WP09 gate, T-46 — "5 [cockpit-adjacent] routes lack
// route-level auth tests; cockpit client-supplied-id mutation not caught by any test; code is
// correct, just un-netted"). Mirrors billing-routes-auth.test.ts / handoff-pending-route.test.ts's
// module-boundary-mocking pattern: `getCurrentSession` is mocked so the REAL `withOnboardingGate`-
// wrapped route handlers run; the underlying team-calendar SERVICES (already proven correct and
// service-level-tested in team-calendar-*.test.ts) are mocked so this suite stays a pure
// route-wiring/auth/RBAC/org-scoping test.
//
// Covers /api/team/dashboard, /api/team/rep/[userId], /api/team/calendar, /api/team/calendar-link,
// /api/team/cockpit, /api/team/enterprise, /api/team/enterprise/seats,
// /api/team/appointments/propose, /api/team/coaching-sessions/propose.
//
// NOTE on jest.mock hoisting: every `jest.mock(...)` and its `mock*`-prefixed helper variables are
// declared at MODULE top level (never nested inside a `describe`) so babel-plugin-jest-hoist hoists
// them predictably, and each mocked module path is targeted by exactly ONE jest.mock call.

import { OnboardingStatus, OrgType, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

const mockResolveTeamMemberIds = jest.fn();
const mockDashboardGetRoster = jest.fn();
const mockDashboardSortRoster = jest.fn();
const mockDashboardGetNeedsYouNow = jest.fn();
const mockDashboardGetDownlineLeak = jest.fn();
const mockDashboardGetFieldTrainerRatioPanel = jest.fn();
const mockDashboardGetTeamAvailabilityAggregate = jest.fn();
jest.mock('@/services/team-calendar/dashboard.service', () => ({
  resolveTeamMemberIds: mockResolveTeamMemberIds,
  DashboardService: jest.fn().mockImplementation(() => ({
    getRoster: mockDashboardGetRoster,
    sortRoster: mockDashboardSortRoster,
    getNeedsYouNow: mockDashboardGetNeedsYouNow,
    getDownlineLeak: mockDashboardGetDownlineLeak,
    getFieldTrainerRatioPanel: mockDashboardGetFieldTrainerRatioPanel,
    getTeamAvailabilityAggregate: mockDashboardGetTeamAvailabilityAggregate,
  })),
}));

const mockGetRepDrillIn = jest.fn();
jest.mock('@/services/team-calendar/rep-drill-in.service', () => ({ getRepDrillIn: mockGetRepDrillIn }));

const mockGetCockpit = jest.fn();
jest.mock('@/services/team-calendar/sponsor-cockpit.service', () => ({
  SponsorCockpitService: jest.fn().mockImplementation(() => ({ getCockpit: mockGetCockpit })),
}));

const mockListBroadcastEvents = jest.fn();
const mockGetPersonalAgenda = jest.fn();
const mockCreateBroadcastEvent = jest.fn();
const mockGetConnectionStatus = jest.fn();
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
jest.mock('@/services/team-calendar/calendar.service', () => ({
  TeamCalendarService: jest.fn().mockImplementation(() => ({
    listBroadcastEvents: mockListBroadcastEvents,
    getPersonalAgenda: mockGetPersonalAgenda,
    createBroadcastEvent: mockCreateBroadcastEvent,
    getConnectionStatus: mockGetConnectionStatus,
    connect: mockConnect,
    disconnect: mockDisconnect,
  })),
}));

const mockListSeats = jest.fn();
const mockGetLatestNarrative = jest.fn();
const mockGetConfig = jest.fn();
const mockUpdateSsoConfig = jest.fn();
const mockUpdateOnboardingConfig = jest.fn();
const mockAssignSeat = jest.fn();
const mockRevokeSeat = jest.fn();
jest.mock('@/services/team-calendar/enterprise-console.service', () => ({
  EnterpriseConsoleService: jest.fn().mockImplementation(() => ({
    listSeats: mockListSeats,
    getLatestNarrative: mockGetLatestNarrative,
    getConfig: mockGetConfig,
    updateSsoConfig: mockUpdateSsoConfig,
    updateOnboardingConfig: mockUpdateOnboardingConfig,
    assignSeat: mockAssignSeat,
    revokeSeat: mockRevokeSeat,
  })),
}));

const mockProposeClosingAppointment = jest.fn();
const mockProposeCoachingSession = jest.fn();
jest.mock('@/services/team-calendar/booking.service', () => ({
  BookingService: jest.fn().mockImplementation(() => ({
    proposeClosingAppointment: mockProposeClosingAppointment,
    proposeCoachingSession: mockProposeCoachingSession,
  })),
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET as dashboardGET } from '@/app/api/team/dashboard/route';
import { GET as repDrillInGET } from '@/app/api/team/rep/[userId]/route';
import { GET as calendarGET, POST as calendarPOST } from '@/app/api/team/calendar/route';
import { GET as calendarLinkGET } from '@/app/api/team/calendar-link/route';
import { GET as cockpitGET } from '@/app/api/team/cockpit/route';
import { GET as enterpriseGET, PATCH as enterprisePATCH } from '@/app/api/team/enterprise/route';
import { POST as seatsPOST, DELETE as seatsDELETE } from '@/app/api/team/enterprise/seats/route';
import { POST as appointmentsProposePOST } from '@/app/api/team/appointments/propose/route';
import { POST as coachingProposePOST } from '@/app/api/team/coaching-sessions/propose/route';

const mockGetSession = getCurrentSession as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const FORGED = { 'x-user-id': 'victim-999' };

function session(overrides: Partial<Session['user']> = {}): Session {
  return {
    expires: '2999-01-01',
    user: {
      id: 'user-1',
      role: Role.UPLINE,
      orgType: OrgType.PRIMERICA,
      organizationId: 'orgA',
      accessTier: 'FREE_PAID_EXTERNAL',
      onboardingStatus: OnboardingStatus.GATED_COMPLETE,
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      deviceFingerprintHash: 'fp',
      securityVersionAtIssue: 0,
      boundAt: Date.now(),
      ...overrides,
    },
  } as unknown as Session;
}

/** Every route here is wrapped by `withOnboardingGate`, whose OWN `prisma.user.findUnique` read
 *  (selecting `onboarding_status`) must resolve to gated-complete for the real handler body to
 *  run. Some routes ALSO call `prisma.user`/`prisma.contact` directly for their own ownership/org
 *  checks — `extraUserRows`/`extraContactRows` let a test seed those without clobbering the gate's
 *  own read, by branching on the `select` shape exactly like the gate's own query (which always
 *  selects `onboarding_status`; no other caller in this codebase selects that field). */
function primeDb(opts: {
  users?: { id: string; organization_id?: string | null; role?: string; upline_id?: string | null }[];
  contacts?: { id: string; user_id: string }[];
} = {}) {
  db.user = {
    findUnique: jest.fn(async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) => {
      if (select && 'onboarding_status' in select) {
        return { onboarding_status: OnboardingStatus.GATED_COMPLETE, onboarding_sessions: [] };
      }
      return (opts.users ?? []).find((u) => u.id === where.id) ?? null;
    }),
  };
  // ENFORCING mock (mirrors real Prisma `findFirst` semantics, and the T-R24 gamification-referral
  // fix's own lesson): a field is only filtered on when the caller's `where` actually includes it,
  // so a production regression that DROPS `user_id` from the ownership where-clause genuinely
  // widens what matches here too — a naive "match on id, ignore user_id" mock would make the
  // ownership tests below pass for the wrong reason and never catch that class of mutation.
  db.contact = {
    findFirst: jest.fn(async ({ where }: { where: { id: string; user_id?: string } }) => {
      const row = (opts.contacts ?? []).find((c) => c.id === where.id);
      if (!row) return null;
      if ('user_id' in where && row.user_id !== where.user_id) return null;
      return row;
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  primeDb();
});

// ─── GET /api/team/dashboard ────────────────────────────────────────────────────────────────────

describe('GET /api/team/dashboard', () => {
  beforeEach(() => {
    mockResolveTeamMemberIds.mockResolvedValue(['rep-1']);
    mockDashboardGetRoster.mockResolvedValue([]);
    mockDashboardSortRoster.mockImplementation((rows: unknown[]) => rows);
    mockDashboardGetNeedsYouNow.mockResolvedValue([]);
    mockDashboardGetDownlineLeak.mockResolvedValue([]);
    mockDashboardGetFieldTrainerRatioPanel.mockResolvedValue({ appointmentsRun: 0, completed: 0, noShows: 0, closeRate: 0 });
    mockDashboardGetTeamAvailabilityAggregate.mockResolvedValue([]);
  });

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await dashboardGET(new NextRequest('http://localhost/api/team/dashboard', { headers: FORGED }), {});
    expect(res.status).toBe(401);
  });

  test('team_metrics RBAC: a REP is denied (403) — a plain rep has no downline dashboard', async () => {
    mockGetSession.mockResolvedValue(session({ role: Role.REP }));
    const res = await dashboardGET(new NextRequest('http://localhost/api/team/dashboard'), {});
    expect(res.status).toBe(403);
    expect(mockResolveTeamMemberIds).not.toHaveBeenCalled();
  });

  test('an UPLINE is allowed (200); identity comes from the SESSION, never the forged x-user-id header', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'real-upline', role: Role.UPLINE }));
    const res = await dashboardGET(new NextRequest('http://localhost/api/team/dashboard', { headers: FORGED }), {});
    expect(res.status).toBe(200);
    expect(mockResolveTeamMemberIds).toHaveBeenCalledWith(expect.anything(), { id: 'real-upline', role: Role.UPLINE, organizationId: 'orgA' });
    expect(mockResolveTeamMemberIds).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'victim-999' }));
  });

  test('an RVP is allowed (200)', async () => {
    mockGetSession.mockResolvedValue(session({ role: Role.RVP }));
    const res = await dashboardGET(new NextRequest('http://localhost/api/team/dashboard'), {});
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/team/rep/[userId] — the drill-in ─────────────────────────────────────────────────

describe('GET /api/team/rep/[userId]', () => {
  function ctx(userId: string) {
    return { params: { userId } };
  }

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await repDrillInGET(new NextRequest('http://localhost/api/team/rep/target-1', { headers: FORGED }), ctx('target-1'));
    expect(res.status).toBe(401);
  });

  test('team_metrics RBAC: a REP is denied — 404 (never 403, so a rep gets no signal a drill-in surface exists)', async () => {
    mockGetSession.mockResolvedValue(session({ role: Role.REP }));
    const res = await repDrillInGET(new NextRequest('http://localhost/api/team/rep/target-1'), ctx('target-1'));
    expect(res.status).toBe(404);
    expect(mockGetRepDrillIn).not.toHaveBeenCalled();
  });

  test('cross-org / non-downline target -> 404 (getRepDrillIn resolves null; the route never distinguishes "not found" from "not yours")', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'real-upline', role: Role.UPLINE }));
    mockGetRepDrillIn.mockResolvedValue(null);
    const res = await repDrillInGET(new NextRequest('http://localhost/api/team/rep/not-my-downline'), ctx('not-my-downline'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  test('a reachable downline target -> 200; identity comes from the SESSION, never the forged x-user-id header', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'real-upline', role: Role.UPLINE, organizationId: 'orgA' }));
    mockGetRepDrillIn.mockResolvedValue({ repUserId: 'target-1', repName: 'Target One', pipelineStateCounts: {}, namesInPlay: [], appointments: [], attendance: [], milestones: [], privacyBoundary: 'boundary' });
    const res = await repDrillInGET(new NextRequest('http://localhost/api/team/rep/target-1', { headers: FORGED }), ctx('target-1'));
    expect(res.status).toBe(200);
    expect(mockGetRepDrillIn).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'real-upline', role: Role.UPLINE, organizationId: 'orgA' },
      'target-1'
    );
    expect(mockGetRepDrillIn).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'victim-999' }), expect.anything());
  });
});

// ─── GET/POST /api/team/calendar — read all, write (broadcast) RVP/ADMIN-only ──────────────────

describe('GET/POST /api/team/calendar', () => {
  beforeEach(() => {
    mockListBroadcastEvents.mockResolvedValue([]);
    mockGetPersonalAgenda.mockResolvedValue([]);
    mockCreateBroadcastEvent.mockResolvedValue({ id: 'evt-1' });
  });

  test('GET 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await calendarGET(new NextRequest('http://localhost/api/team/calendar', { headers: FORGED }), {});
    expect(res.status).toBe(401);
  });

  test('GET 200 for a REP (read is open to everyone) — identity comes from the SESSION, never the forged header', async () => {
    primeDb({ users: [{ id: 'real-rep', upline_id: 'upline-x' }] });
    mockGetSession.mockResolvedValue(session({ id: 'real-rep', role: Role.REP, organizationId: 'orgA' }));
    const res = await calendarGET(new NextRequest('http://localhost/api/team/calendar', { headers: FORGED }), {});
    expect(res.status).toBe(200);
    expect(mockListBroadcastEvents).toHaveBeenCalledWith('orgA', 'real-rep');
    expect(mockGetPersonalAgenda).toHaveBeenCalledWith('real-rep');
  });

  test('POST (RVP-only write gate): a REP is DENIED 403, createBroadcastEvent never called', async () => {
    mockGetSession.mockResolvedValue(session({ role: Role.REP }));
    const res = await calendarPOST(
      new NextRequest('http://localhost/api/team/calendar', { method: 'POST', body: JSON.stringify({ type: 'training', startsAt: '2026-08-01T00:00:00.000Z' }) }),
      {}
    );
    expect(res.status).toBe(403);
    expect(mockCreateBroadcastEvent).not.toHaveBeenCalled();
  });

  test('POST (RVP-only write gate): an UPLINE is ALSO denied 403 (only RVP/ADMIN may write)', async () => {
    mockGetSession.mockResolvedValue(session({ role: Role.UPLINE }));
    const res = await calendarPOST(
      new NextRequest('http://localhost/api/team/calendar', { method: 'POST', body: JSON.stringify({ type: 'training', startsAt: '2026-08-01T00:00:00.000Z' }) }),
      {}
    );
    expect(res.status).toBe(403);
    expect(mockCreateBroadcastEvent).not.toHaveBeenCalled();
  });

  test('POST: an RVP is allowed (201)', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'real-rvp', role: Role.RVP, organizationId: 'orgA' }));
    const res = await calendarPOST(
      new NextRequest('http://localhost/api/team/calendar', { method: 'POST', body: JSON.stringify({ type: 'training', startsAt: '2026-08-01T00:00:00.000Z' }) }),
      {}
    );
    expect(res.status).toBe(201);
    expect(mockCreateBroadcastEvent).toHaveBeenCalledWith('orgA', 'real-rvp', 'training', new Date('2026-08-01T00:00:00.000Z'), true);
  });
});

// ─── GET /api/team/calendar-link — own-data only ───────────────────────────────────────────────

describe('GET /api/team/calendar-link', () => {
  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await calendarLinkGET(new NextRequest('http://localhost/api/team/calendar-link', { headers: FORGED }), {});
    expect(res.status).toBe(401);
  });

  test('identity comes from the SESSION, never the forged x-user-id header', async () => {
    mockGetConnectionStatus.mockResolvedValue([]);
    mockGetSession.mockResolvedValue(session({ id: 'real-user' }));
    const res = await calendarLinkGET(new NextRequest('http://localhost/api/team/calendar-link', { headers: FORGED }), {});
    expect(res.status).toBe(200);
    expect(mockGetConnectionStatus).toHaveBeenCalledWith('real-user');
    expect(mockGetConnectionStatus).not.toHaveBeenCalledWith('victim-999');
  });
});

// ─── GET /api/team/cockpit — ALWAYS scoped to the SESSION user; never a client-supplied sponsor id ─

describe('GET /api/team/cockpit (WP09 §14.5 P0 — own-data only, no sponsorUserId param exists)', () => {
  beforeEach(() => {
    mockGetCockpit.mockResolvedValue([]);
  });

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await cockpitGET(new NextRequest('http://localhost/api/team/cockpit', { headers: FORGED }), {});
    expect(res.status).toBe(401);
  });

  test('a client-supplied ?sponsorUserId= query param has ZERO effect — getCockpit is called with the SESSION id', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'real-sponsor', role: Role.REP }));
    const res = await cockpitGET(
      new NextRequest('http://localhost/api/team/cockpit?sponsorUserId=victim-999', { headers: FORGED }),
      {}
    );
    expect(res.status).toBe(200);
    expect(mockGetCockpit).toHaveBeenCalledTimes(1);
    expect(mockGetCockpit).toHaveBeenCalledWith('real-sponsor', expect.any(Date));
    expect(mockGetCockpit).not.toHaveBeenCalledWith('victim-999', expect.anything());
  });

  test('every role may read their own cockpit (sponsor_cockpit is a flat read grant — the real gate is row-level ownership, enforced by always passing the session id)', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'real-rep', role: Role.REP }));
    const res = await cockpitGET(new NextRequest('http://localhost/api/team/cockpit'), {});
    expect(res.status).toBe(200);
  });
});

// ─── GET/PATCH /api/team/enterprise — RVP/ADMIN only, org-scoped from the session ──────────────

describe('GET/PATCH /api/team/enterprise', () => {
  beforeEach(() => {
    mockListSeats.mockResolvedValue([]);
    mockGetLatestNarrative.mockResolvedValue(null);
    mockGetConfig.mockResolvedValue(null);
  });

  test('GET 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await enterpriseGET(new NextRequest('http://localhost/api/team/enterprise', { headers: FORGED }), {});
    expect(res.status).toBe(401);
  });

  test('GET: a REP is denied 403 — enterprise console is RVP/ADMIN only', async () => {
    mockGetSession.mockResolvedValue(session({ role: Role.REP }));
    const res = await enterpriseGET(new NextRequest('http://localhost/api/team/enterprise'), {});
    expect(res.status).toBe(403);
    expect(mockListSeats).not.toHaveBeenCalled();
  });

  test('GET: an UPLINE is ALSO denied 403 (only RVP/ADMIN)', async () => {
    mockGetSession.mockResolvedValue(session({ role: Role.UPLINE }));
    const res = await enterpriseGET(new NextRequest('http://localhost/api/team/enterprise'), {});
    expect(res.status).toBe(403);
  });

  test('GET: an RVP is allowed — org-scoped from the SESSION, never a client-supplied org id', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'real-rvp', role: Role.RVP, organizationId: 'orgA' }));
    const res = await enterpriseGET(new NextRequest('http://localhost/api/team/enterprise', { headers: FORGED }), {});
    expect(res.status).toBe(200);
    expect(mockListSeats).toHaveBeenCalledWith('orgA');
  });

  test('PATCH: a REP is denied 403 — manage is RVP/ADMIN only', async () => {
    mockGetSession.mockResolvedValue(session({ role: Role.REP }));
    const res = await enterprisePATCH(
      new NextRequest('http://localhost/api/team/enterprise', { method: 'PATCH', body: JSON.stringify({ onboardingWelcomeMessage: 'hi' }) }),
      {}
    );
    expect(res.status).toBe(403);
    expect(mockUpdateOnboardingConfig).not.toHaveBeenCalled();
  });
});

// ─── POST/DELETE /api/team/enterprise/seats — RVP/ADMIN only, same-org enforced on assign ─────

describe('POST/DELETE /api/team/enterprise/seats', () => {
  beforeEach(() => {
    mockAssignSeat.mockResolvedValue({ id: 'seat-1' });
    mockRevokeSeat.mockResolvedValue({ id: 'seat-1' });
  });

  test('POST: a REP is denied 403 — seat management is RVP/ADMIN only, assignSeat never called', async () => {
    mockGetSession.mockResolvedValue(session({ role: Role.REP }));
    const res = await seatsPOST(
      new NextRequest('http://localhost/api/team/enterprise/seats', { method: 'POST', body: JSON.stringify({ userId: 'target-1' }) }),
      {}
    );
    expect(res.status).toBe(403);
    expect(mockAssignSeat).not.toHaveBeenCalled();
  });

  test('POST: an RVP assigning a seat to a user OUTSIDE their org -> 404, never a cross-org grant', async () => {
    primeDb({ users: [{ id: 'target-1', organization_id: 'orgB' }] }); // different org than the caller
    mockGetSession.mockResolvedValue(session({ role: Role.RVP, organizationId: 'orgA' }));
    const res = await seatsPOST(
      new NextRequest('http://localhost/api/team/enterprise/seats', { method: 'POST', body: JSON.stringify({ userId: 'target-1' }) }),
      {}
    );
    expect(res.status).toBe(404);
    expect(mockAssignSeat).not.toHaveBeenCalled();
  });

  test('POST: an RVP assigning a seat to a SAME-org user -> 201', async () => {
    primeDb({ users: [{ id: 'target-1', organization_id: 'orgA' }] });
    mockGetSession.mockResolvedValue(session({ id: 'real-rvp', role: Role.RVP, organizationId: 'orgA' }));
    const res = await seatsPOST(
      new NextRequest('http://localhost/api/team/enterprise/seats', { method: 'POST', body: JSON.stringify({ userId: 'target-1' }) }),
      {}
    );
    expect(res.status).toBe(201);
    expect(mockAssignSeat).toHaveBeenCalledWith('orgA', 'target-1', 'real-rvp');
  });

  test('DELETE: a REP is denied 403 — revokeSeat never called', async () => {
    mockGetSession.mockResolvedValue(session({ role: Role.REP }));
    const res = await seatsDELETE(new NextRequest('http://localhost/api/team/enterprise/seats?seatId=seat-1', { method: 'DELETE' }), {});
    expect(res.status).toBe(403);
    expect(mockRevokeSeat).not.toHaveBeenCalled();
  });
});

// ─── POST /api/team/appointments/propose — contact-ownership + same-org trainer ────────────────

describe('POST /api/team/appointments/propose', () => {
  beforeEach(() => {
    mockProposeClosingAppointment.mockResolvedValue({ outcome: 'proposed' });
  });

  function body(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({ trainerId: 'trainer-1', contactId: 'contact-1', ...overrides });
  }

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await appointmentsProposePOST(new NextRequest('http://localhost/api/team/appointments/propose', { method: 'POST', body: body(), headers: FORGED }), {});
    expect(res.status).toBe(401);
  });

  test('ownership: a contact NOT owned by the caller -> 404, never proposes on someone else\'s community member', async () => {
    // A valid, same-org trainer IS seeded so this isolates the contact-ownership gate specifically —
    // without it, a mutation that dropped the ownership filter could still incidentally 404 via the
    // (unrelated) trainer lookup, masking the very regression this test exists to catch.
    primeDb({
      contacts: [{ id: 'contact-1', user_id: 'someone-else' }], // not owned by the caller
      users: [{ id: 'trainer-1', organization_id: 'orgA', role: 'UPLINE' }],
    });
    mockGetSession.mockResolvedValue(session({ id: 'real-rep', role: Role.REP, organizationId: 'orgA' }));
    const res = await appointmentsProposePOST(new NextRequest('http://localhost/api/team/appointments/propose', { method: 'POST', body: body() }), {});
    expect(res.status).toBe(404);
    expect(mockProposeClosingAppointment).not.toHaveBeenCalled();
  });

  test('cross-org trainer -> 404, never books a "trainer" outside the org', async () => {
    primeDb({
      contacts: [{ id: 'contact-1', user_id: 'real-rep' }],
      users: [{ id: 'trainer-1', organization_id: 'orgB', role: 'UPLINE' }], // different org
    });
    mockGetSession.mockResolvedValue(session({ id: 'real-rep', role: Role.REP, organizationId: 'orgA' }));
    const res = await appointmentsProposePOST(new NextRequest('http://localhost/api/team/appointments/propose', { method: 'POST', body: body() }), {});
    expect(res.status).toBe(404);
    expect(mockProposeClosingAppointment).not.toHaveBeenCalled();
  });

  test('own contact + same-org trainer -> 201; identity comes from the SESSION, never the forged x-user-id header', async () => {
    primeDb({
      contacts: [{ id: 'contact-1', user_id: 'real-rep' }],
      users: [{ id: 'trainer-1', organization_id: 'orgA', role: 'UPLINE' }],
    });
    mockGetSession.mockResolvedValue(session({ id: 'real-rep', role: Role.REP, organizationId: 'orgA' }));
    const res = await appointmentsProposePOST(new NextRequest('http://localhost/api/team/appointments/propose', { method: 'POST', body: body(), headers: FORGED }), {});
    expect(res.status).toBe(201);
    expect(mockProposeClosingAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ repId: 'real-rep', trainerId: 'trainer-1', contactId: 'contact-1', organizationId: 'orgA' })
    );
    expect(mockProposeClosingAppointment).not.toHaveBeenCalledWith(expect.objectContaining({ repId: 'victim-999' }));
  });
});

// ─── POST /api/team/coaching-sessions/propose — must be one of the two parties, same-org ──────

describe('POST /api/team/coaching-sessions/propose', () => {
  beforeEach(() => {
    mockProposeCoachingSession.mockResolvedValue({ outcome: 'proposed' });
  });

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await coachingProposePOST(new NextRequest('http://localhost/api/team/coaching-sessions/propose', { method: 'POST', body: JSON.stringify({ trainerId: 'trainer-1' }), headers: FORGED }), {});
    expect(res.status).toBe(401);
  });

  test('a caller who is NEITHER named party (not rep, not trainer) is denied 403 — never a third party booking on others\' behalf', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'real-rep', role: Role.REP, organizationId: 'orgA' }));
    const res = await coachingProposePOST(
      new NextRequest('http://localhost/api/team/coaching-sessions/propose', { method: 'POST', body: JSON.stringify({ repId: 'other-rep', trainerId: 'other-trainer' }) }),
      {}
    );
    expect(res.status).toBe(403);
    expect(mockProposeCoachingSession).not.toHaveBeenCalled();
  });

  test('cross-org trainer -> 404 (the rep side resolves fine — this isolates the trainer\'s org as the reason)', async () => {
    primeDb({ users: [{ id: 'trainer-1', organization_id: 'orgB' }, { id: 'real-rep', organization_id: 'orgA' }] });
    mockGetSession.mockResolvedValue(session({ id: 'real-rep', role: Role.REP, organizationId: 'orgA' }));
    const res = await coachingProposePOST(
      new NextRequest('http://localhost/api/team/coaching-sessions/propose', { method: 'POST', body: JSON.stringify({ trainerId: 'trainer-1' }) }),
      {}
    );
    expect(res.status).toBe(404);
    expect(mockProposeCoachingSession).not.toHaveBeenCalled();
  });

  test('the caller as the REP party, same-org trainer -> 201; identity comes from the SESSION, never the forged x-user-id header', async () => {
    primeDb({ users: [{ id: 'trainer-1', organization_id: 'orgA' }, { id: 'real-rep', organization_id: 'orgA' }] });
    mockGetSession.mockResolvedValue(session({ id: 'real-rep', role: Role.REP, organizationId: 'orgA' }));
    const res = await coachingProposePOST(
      new NextRequest('http://localhost/api/team/coaching-sessions/propose', { method: 'POST', body: JSON.stringify({ trainerId: 'trainer-1' }), headers: FORGED }),
      {}
    );
    expect(res.status).toBe(201);
    expect(mockProposeCoachingSession).toHaveBeenCalledWith(
      expect.objectContaining({ repId: 'real-rep', trainerId: 'trainer-1', organizationId: 'orgA' })
    );
    expect(mockProposeCoachingSession).not.toHaveBeenCalledWith(expect.objectContaining({ repId: 'victim-999' }));
  });
});
