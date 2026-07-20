// T-R26 — SECURITY FIX: DELETE /api/team/enterprise/seats (revokeSeat) did NOT validate the seat's
// organization_id against the caller's org before revoking, so any RVP/ADMIN could revoke ANOTHER
// org's enterprise seat just by knowing its id (found live by the T-R24 route-auth-test pass). The
// sibling POST (assignSeat) already validated same-org; this adds the identical defense-in-depth
// check to DELETE, mirroring the module-boundary-mocking pattern of billing-routes-auth.test.ts:
// `getCurrentSession` + `prisma` are mocked so the REAL withOnboardingGate-wrapped handlers run,
// with a forged `x-user-id` header attached to prove identity comes ONLY from the session.

import { Role, OrgType, AccessTier, OnboardingStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { DELETE as seatsDELETE } from '@/app/api/team/enterprise/seats/route';

const mockGetSession = getCurrentSession as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function session(role: Role, organizationId: string | null): Session {
  return {
    expires: '2999-01-01',
    user: {
      id: 'admin-1',
      role,
      orgType: OrgType.EXTERNAL,
      organizationId,
      accessTier: AccessTier.FREE_PAID_EXTERNAL,
      onboardingStatus: OnboardingStatus.GATED_COMPLETE,
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      deviceFingerprintHash: 'fp',
      securityVersionAtIssue: 0,
      boundAt: Date.now(),
    },
  } as unknown as Session;
}

/** Onboarding gate reads user.findUnique(onboarding_status); complete so the handler proceeds. */
function primeGateComplete() {
  db.user = {
    findUnique: jest.fn().mockResolvedValue({ onboarding_status: OnboardingStatus.GATED_COMPLETE, onboarding_sessions: [] }),
  };
}

// A forged header claiming to BE a user in another org — the route reads identity only from the
// verified session (never a header), so this must have zero effect on any test's outcome.
const FORGED = { 'x-user-id': 'victim-in-org-b' };

function deleteReq(seatId: string) {
  return new NextRequest(`http://localhost/api/team/enterprise/seats?seatId=${seatId}`, {
    method: 'DELETE',
    headers: FORGED,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  primeGateComplete();
});

describe('DELETE /api/team/enterprise/seats (revokeSeat) — org isolation (T-R26 fix for T-R24 finding)', () => {
  test('RVP revokes a seat in their OWN org → 200, seat REVOKED (forged x-user-id header inert)', async () => {
    mockGetSession.mockResolvedValue(session(Role.RVP, 'org-a'));
    const findUnique = jest.fn().mockResolvedValue({ organization_id: 'org-a' });
    const update = jest.fn().mockResolvedValue({ id: 'seat-1', organization_id: 'org-a', assigned_user_id: 'user-9', status: 'REVOKED' });
    db.enterpriseSeatAssignment = { findUnique, update };

    const res = await seatsDELETE(deleteReq('seat-1'), {} as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seat.status).toBe('REVOKED');
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'seat-1' }, select: { organization_id: true } });
    expect(update).toHaveBeenCalledWith({ where: { id: 'seat-1' }, data: { status: 'REVOKED' } });
  });

  test('cross-org revoke (seat organization_id != caller org) → 404-not-leak, seat NOT revoked', async () => {
    mockGetSession.mockResolvedValue(session(Role.ADMIN, 'org-a'));
    const findUnique = jest.fn().mockResolvedValue({ organization_id: 'org-b' }); // seat belongs to a DIFFERENT org
    const update = jest.fn();
    db.enterpriseSeatAssignment = { findUnique, update };

    const res = await seatsDELETE(deleteReq('seat-owned-by-org-b'), {} as never);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Seat not found.');
    // TEETH: the mismatched-org seat must never reach the revoke mutation.
    expect(update).not.toHaveBeenCalled();
  });

  test('a nonexistent seat id gets the SAME 404 message as a cross-org seat (no existence leak)', async () => {
    mockGetSession.mockResolvedValue(session(Role.RVP, 'org-a'));
    const findUnique = jest.fn().mockResolvedValue(null);
    const update = jest.fn();
    db.enterpriseSeatAssignment = { findUnique, update };

    const res = await seatsDELETE(deleteReq('nonexistent-seat'), {} as never);

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Seat not found.');
    expect(update).not.toHaveBeenCalled();
  });

  test('forged x-user-id header has ZERO effect — identity/org come only from the session', async () => {
    // Session says org-a; the forged header claims a different identity entirely. The seat is in
    // org-a, so this must succeed exactly as if no header were sent — proving the header is inert.
    mockGetSession.mockResolvedValue(session(Role.RVP, 'org-a'));
    const findUnique = jest.fn().mockResolvedValue({ organization_id: 'org-a' });
    const update = jest.fn().mockResolvedValue({ id: 'seat-1', organization_id: 'org-a', assigned_user_id: 'user-9', status: 'REVOKED' });
    db.enterpriseSeatAssignment = { findUnique, update };

    const withForgedHeader = await seatsDELETE(deleteReq('seat-1'), {} as never);
    expect(withForgedHeader.status).toBe(200);

    // No lookup of any kind is ever keyed off the forged header's user id — org-scoping is decided
    // solely from identity.organizationId (the session), which is what findUnique/update above prove.
    expect(findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'victim-in-org-b' } }));
  });

  test('RBAC gate is still intact: a REP (non-RVP/ADMIN) is denied 403 before any org check runs', async () => {
    mockGetSession.mockResolvedValue(session(Role.REP, 'org-a'));
    const findUnique = jest.fn();
    db.enterpriseSeatAssignment = { findUnique, update: jest.fn() };

    const res = await seatsDELETE(deleteReq('seat-1'), {} as never);

    expect(res.status).toBe(403);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
