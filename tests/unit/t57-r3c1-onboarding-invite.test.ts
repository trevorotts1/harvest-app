// T-57 R3c-1 (MAJOR-M7, master-spec §6.6 Upline invite state machine). Before this fix, NOTHING in
// `src/app/api` ever called `invite-state-machine.ts`/`SponsorInviteService` — the fully-built,
// fully-unit-tested §6.6 state machine had zero HTTP surface, and `/onboarding/invite` 404'd. This
// proves the new route is real (unauthenticated, matching a fresh invite recipient with no session
// yet), advances a genuine SENT invite to PENDING (the real transition graph, not re-derived), and
// never presents an expired/rejected invite as live.

import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    uplineInvite: { findUnique: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/onboarding/invite/route';
import { InviteStatus } from '@/types/onboarding';

const mockedInviteFindUnique = (prisma as unknown as { uplineInvite: { findUnique: jest.Mock } }).uplineInvite.findUnique;
const mockedInviteUpdate = (prisma as unknown as { uplineInvite: { update: jest.Mock } }).uplineInvite.update;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;

function req(inviteId?: string): NextRequest {
  const url = inviteId ? `http://localhost/api/onboarding/invite?invite_id=${inviteId}` : 'http://localhost/api/onboarding/invite';
  return new NextRequest(url);
}

function inviteRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'invite-1',
    sponsor_id: 'sponsor-1',
    recipient_email: 'recruit@example.com',
    status: InviteStatus.SENT,
    created_at: new Date(),
    responded_at: null,
    resend_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mockedInviteFindUnique.mockReset();
  mockedInviteUpdate.mockReset();
  mockedUserFindUnique.mockReset();
});

describe('GET /api/onboarding/invite — unauthenticated (no session exists yet for a fresh recipient)', () => {
  test('missing invite_id -> 400', async () => {
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  test('an invite that does not exist -> 404, never a crash', async () => {
    mockedInviteFindUnique.mockResolvedValue(null);
    const res = await GET(req('does-not-exist'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  test('RED (pre-fix) would be: no route exists at all — this proves a fresh SENT invite opens (real §6.6 transition, SENT -> PENDING)', async () => {
    mockedInviteFindUnique.mockResolvedValue(inviteRow({ status: InviteStatus.SENT }));
    mockedInviteUpdate.mockResolvedValue({});
    mockedUserFindUnique.mockResolvedValue({ name: 'Jordan Lee', org_type: 'PRIMERICA', role: 'UPLINE' });

    const res = await GET(req('invite-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.code).toBe('READY');
    expect(body.invite.status).toBe('PENDING');
    // The REAL transition was persisted, not just returned — proves this isn't a read-only stub.
    expect(mockedInviteUpdate).toHaveBeenCalledWith({ where: { id: 'invite-1' }, data: { status: 'PENDING' } });
  });

  test('the sponsor\'s REAL org/role are resolved and returned ("pre-seeds sponsor + org + role", §6.6)', async () => {
    mockedInviteFindUnique.mockResolvedValue(inviteRow({ status: InviteStatus.SENT }));
    mockedInviteUpdate.mockResolvedValue({});
    mockedUserFindUnique.mockResolvedValue({ name: 'Jordan Lee', org_type: 'PRIMERICA', role: 'UPLINE' });

    const res = await GET(req('invite-1'));
    const body = await res.json();
    expect(body.sponsor).toEqual({ name: 'Jordan Lee', orgType: 'PRIMERICA', role: 'UPLINE' });
    expect(mockedUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sponsor-1' } })
    );
  });

  test('a re-visit to an already-PENDING invite is idempotent — no illegal-transition error, no crash', async () => {
    mockedInviteFindUnique.mockResolvedValue(inviteRow({ status: InviteStatus.PENDING }));
    mockedUserFindUnique.mockResolvedValue({ name: 'Jordan Lee', org_type: 'PRIMERICA', role: 'UPLINE' });

    const res = await GET(req('invite-1'));
    expect(res.status).toBe(200);
    expect(mockedInviteUpdate).not.toHaveBeenCalled();
  });

  test('an already-ACCEPTED invite -> 200 with code ALREADY_ACCEPTED, never re-transitioned', async () => {
    mockedInviteFindUnique.mockResolvedValue(inviteRow({ status: InviteStatus.ACCEPTED }));
    mockedUserFindUnique.mockResolvedValue({ name: 'Jordan Lee', org_type: 'PRIMERICA', role: 'UPLINE' });

    const res = await GET(req('invite-1'));
    const body = await res.json();
    expect(body.code).toBe('ALREADY_ACCEPTED');
    expect(mockedInviteUpdate).not.toHaveBeenCalled();
  });

  test('a REJECTED invite -> 410, honest, never presented as acceptable', async () => {
    mockedInviteFindUnique.mockResolvedValue(inviteRow({ status: InviteStatus.REJECTED }));
    const res = await GET(req('invite-1'));
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe('REJECTED');
  });

  test('an EXPIRED invite -> 410, honest', async () => {
    mockedInviteFindUnique.mockResolvedValue(inviteRow({ status: InviteStatus.EXPIRED }));
    const res = await GET(req('invite-1'));
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe('EXPIRED');
  });

  test('§6.6 "a daily job expires invites older than 7 days still in sent/pending" — a SENT invite past the 7-day window is never presented as live, even before the daily job runs', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    mockedInviteFindUnique.mockResolvedValue(inviteRow({ status: InviteStatus.SENT, created_at: eightDaysAgo }));
    mockedInviteUpdate.mockResolvedValue({});
    const res = await GET(req('invite-1'));
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe('EXPIRED');
    expect(mockedInviteUpdate).toHaveBeenCalledWith({ where: { id: 'invite-1' }, data: { status: 'EXPIRED' } });
  });
});
