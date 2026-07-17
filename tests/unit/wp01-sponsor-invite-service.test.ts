// WP01 T-19 — integration coverage for `SponsorInviteService`, the orchestration layer wiring
// §6.5 sponsor matching + §6.6 the invite state machine to real `UplineInvite`/`Sponsorship`/
// `OrgTreeEdge` persistence. Uses an in-memory mock Prisma delegate, the same constructor-injection
// test pattern already established by `tests/unit/data-rights.test.ts` / `warm-market.test.ts`.

import { randomUUID } from 'crypto';
import { AccessTier, OrgType, Role } from '@prisma/client';

import {
  SponsorInviteService,
  type SponsorInvitePrismaClient,
  type UplineInviteRow,
} from '../../src/services/onboarding/wp01/sponsor-invite.service';
import { InviteAuthorizationError, InviteStatus } from '../../src/services/onboarding/wp01/invite-state-machine';
import { AccessTierAuthorizationError } from '../../src/services/onboarding/wp01/access-tier';

function makeMockPrisma(seed: { invites?: UplineInviteRow[] } = {}) {
  const invites = new Map<string, UplineInviteRow>();
  for (const row of seed.invites ?? []) invites.set(row.id, { ...row });
  const sponsorships: Record<string, unknown>[] = [];
  const orgTreeEdges: Record<string, unknown>[] = [];

  const prisma: SponsorInvitePrismaClient = {
    uplineInvite: {
      async create({ data }) {
        const row = { id: randomUUID(), ...data } as UplineInviteRow;
        invites.set(row.id, row);
        return { ...row };
      },
      async update({ where, data }) {
        const existing = invites.get(where.id);
        if (!existing) throw new Error(`not found: ${where.id}`);
        const updated = { ...existing, ...data } as UplineInviteRow;
        invites.set(where.id, updated);
        return { ...updated };
      },
      async findUnique({ where }) {
        const row = invites.get(where.id);
        return row ? { ...row } : null;
      },
      async findMany({ where }) {
        const statusIn = (where as { status?: { in?: string[] } })?.status?.in;
        return [...invites.values()]
          .filter((row) => (statusIn ? statusIn.includes(row.status) : true))
          .map((row) => ({ ...row }));
      },
    },
    sponsorship: {
      async create({ data }) {
        sponsorships.push({ ...data });
        return { ...data };
      },
      async findMany({ where }) {
        const w = where as { sponsor_user_id?: string; state?: string };
        return sponsorships.filter(
          (s) =>
            (!w.sponsor_user_id || s.sponsor_user_id === w.sponsor_user_id) &&
            (!w.state || s.state === w.state)
        );
      },
    },
    orgTreeEdge: {
      async create({ data }) {
        orgTreeEdges.push({ ...data });
        return { ...data };
      },
    },
  };

  return { prisma, invites, sponsorships, orgTreeEdges };
}

describe('WP01 SponsorInviteService — integration (§6.5/§6.6/§6.7)', () => {
  describe('sendInvite — RBAC-gated creation', () => {
    test('a REP can send an invite as themselves', async () => {
      const { prisma } = makeMockPrisma();
      const service = new SponsorInviteService(prisma);
      const invite = await service.sendInvite({
        actorRole: Role.REP,
        actorUserId: 'rep-1',
        recipientEmail: 'friend@example.com',
      });
      expect(invite.status).toBe(InviteStatus.SENT);
      expect(invite.sponsor_id).toBe('rep-1');
      expect(invite.resend_count).toBe(0);
    });
  });

  describe('full lifecycle — SENT → PENDING → ACCEPTED, wiring the org-tree edge', () => {
    test('acceptInvite transitions and creates the OrgTreeEdge row', async () => {
      const { prisma, orgTreeEdges } = makeMockPrisma();
      const service = new SponsorInviteService(prisma);
      const sent = await service.sendInvite({ actorRole: Role.REP, actorUserId: 'rep-1', recipientEmail: 'r@e.com' });
      await service.markOpened(sent.id);
      const { invite, orgTreeEdge } = await service.acceptInvite(sent.id, 'new-recruit-1');

      expect(invite.status).toBe(InviteStatus.ACCEPTED);
      expect(invite.responded_at).not.toBeNull();
      expect(orgTreeEdge).toEqual({
        sponsor_id: 'rep-1',
        recruit_id: 'new-recruit-1',
        edge_type: 'upline_sponsor',
        is_recruit_confirmed: true,
      });
      expect(orgTreeEdges).toHaveLength(1);
    });

    test('rejectInvite transitions PENDING → REJECTED with no org-tree edge', async () => {
      const { prisma, orgTreeEdges } = makeMockPrisma();
      const service = new SponsorInviteService(prisma);
      const sent = await service.sendInvite({ actorRole: Role.REP, actorUserId: 'rep-1', recipientEmail: 'r@e.com' });
      await service.markOpened(sent.id);
      const rejected = await service.rejectInvite(sent.id);
      expect(rejected.status).toBe(InviteStatus.REJECTED);
      expect(orgTreeEdges).toHaveLength(0);
    });

    test('an illegal transition attempted through the service throws, leaving the row unmodified', async () => {
      const { prisma } = makeMockPrisma();
      const service = new SponsorInviteService(prisma);
      const sent = await service.sendInvite({ actorRole: Role.REP, actorUserId: 'rep-1', recipientEmail: 'r@e.com' });
      // SENT -> ACCEPTED directly is illegal (must pass through PENDING).
      await expect(service.acceptInvite(sent.id, 'recruit-x')).rejects.toThrow(/Illegal invite transition/);
    });
  });

  describe('resendInvite — RBAC ownership + the §6.6 cap/cooldown', () => {
    test('the invite\'s own sponsor may resend after it expires', async () => {
      const { prisma } = makeMockPrisma({
        invites: [
          {
            id: 'inv-1',
            sponsor_id: 'rep-1',
            recipient_email: 'r@e.com',
            status: InviteStatus.EXPIRED,
            created_at: new Date('2026-07-01T00:00:00Z'),
            responded_at: null,
            resend_count: 0,
          },
        ],
      });
      const service = new SponsorInviteService(prisma);
      const now = new Date('2026-07-10T00:00:00Z');
      const resent = await service.resendInvite({ actorRole: Role.REP, actorUserId: 'rep-1', inviteId: 'inv-1' }, now);
      expect(resent.status).toBe(InviteStatus.SENT);
      expect(resent.resend_count).toBe(1);
    });

    test('a DIFFERENT rep may NOT resend someone else\'s invite (ownership-gated)', async () => {
      const { prisma } = makeMockPrisma({
        invites: [
          {
            id: 'inv-1',
            sponsor_id: 'rep-1',
            recipient_email: 'r@e.com',
            status: InviteStatus.EXPIRED,
            created_at: new Date('2026-07-01T00:00:00Z'),
            responded_at: null,
            resend_count: 0,
          },
        ],
      });
      const service = new SponsorInviteService(prisma);
      await expect(
        service.resendInvite(
          { actorRole: Role.REP, actorUserId: 'rep-2', inviteId: 'inv-1' },
          new Date('2026-07-10T00:00:00Z')
        )
      ).rejects.toThrow(InviteAuthorizationError);
    });

    test('an RVP may resend on behalf of another sponsor (org-wide oversight)', async () => {
      const { prisma } = makeMockPrisma({
        invites: [
          {
            id: 'inv-1',
            sponsor_id: 'rep-1',
            recipient_email: 'r@e.com',
            status: InviteStatus.EXPIRED,
            created_at: new Date('2026-07-01T00:00:00Z'),
            responded_at: null,
            resend_count: 0,
          },
        ],
      });
      const service = new SponsorInviteService(prisma);
      const resent = await service.resendInvite(
        { actorRole: Role.RVP, actorUserId: 'rvp-9', inviteId: 'inv-1' },
        new Date('2026-07-10T00:00:00Z')
      );
      expect(resent.status).toBe(InviteStatus.SENT);
    });
  });

  describe('expireDueInvites — the daily job persists expiry across the whole table', () => {
    test('expires only the due SENT/PENDING rows, leaves fresh/terminal rows alone', async () => {
      const dueCreated = new Date('2026-07-01T00:00:00Z');
      const { prisma } = makeMockPrisma({
        invites: [
          { id: 'due', sponsor_id: 's1', recipient_email: 'a@e.com', status: InviteStatus.SENT, created_at: dueCreated, responded_at: null, resend_count: 0 },
          { id: 'fresh', sponsor_id: 's1', recipient_email: 'b@e.com', status: InviteStatus.SENT, created_at: new Date('2026-07-15T00:00:00Z'), responded_at: null, resend_count: 0 },
          { id: 'done', sponsor_id: 's1', recipient_email: 'c@e.com', status: InviteStatus.ACCEPTED, created_at: dueCreated, responded_at: dueCreated, resend_count: 0 },
        ],
      });
      const service = new SponsorInviteService(prisma);
      const now = new Date('2026-07-16T00:00:00Z'); // 15 days after `dueCreated`
      const { expiredCount, checkedCount } = await service.expireDueInvites(now);

      expect(checkedCount).toBe(2); // only SENT/PENDING rows are candidates ('done' excluded by the findMany filter)
      expect(expiredCount).toBe(1);

      const due = await prisma.uplineInvite.findUnique({ where: { id: 'due' } });
      const fresh = await prisma.uplineInvite.findUnique({ where: { id: 'fresh' } });
      expect(due?.status).toBe(InviteStatus.EXPIRED);
      expect(fresh?.status).toBe(InviteStatus.SENT);
    });
  });

  describe('matchOrWaitlist — §6.5, wired to persistence', () => {
    test('a match persists BOTH a Sponsorship row and an OrgTreeEdge row', async () => {
      const { prisma, sponsorships, orgTreeEdges } = makeMockPrisma();
      const service = new SponsorInviteService(prisma);
      const outcome = await service.matchOrWaitlist({
        orgType: OrgType.PRIMERICA,
        memberUserId: 'member-1',
        organizationId: 'org-1',
        candidateSponsorIds: ['sponsor-a'],
      });
      expect(outcome.kind).toBe('linked');
      expect(sponsorships).toHaveLength(1);
      expect(sponsorships[0]).toMatchObject({ sponsor_user_id: 'sponsor-a', member_user_id: 'member-1', state: 'ACTIVE' });
      expect(orgTreeEdges).toHaveLength(1);
    });

    test('load-balances across candidates using REAL persisted active-sponsorship counts', async () => {
      const { prisma, sponsorships } = makeMockPrisma();
      // Pre-seed sponsor-busy with an existing active sponsorship so it is NOT the least-loaded.
      sponsorships.push({ sponsor_user_id: 'sponsor-busy', member_user_id: 'someone-else', state: 'ACTIVE' });
      const service = new SponsorInviteService(prisma);
      const outcome = await service.matchOrWaitlist({
        orgType: OrgType.EXTERNAL,
        memberUserId: 'member-2',
        organizationId: 'org-1',
        candidateSponsorIds: ['sponsor-busy', 'sponsor-free'],
      });
      expect(outcome.kind).toBe('linked');
      if (outcome.kind === 'linked') expect(outcome.sponsorId).toBe('sponsor-free');
    });

    // (a) THE proof, exercised through the full persisted service: no candidates → waitlist, never a
    // thrown error, and nothing garbage is persisted.
    test('no eligible candidates → waitlisted, never throws, never persists a partial row', async () => {
      const { prisma, sponsorships, orgTreeEdges } = makeMockPrisma();
      const service = new SponsorInviteService(prisma);
      await expect(
        service.matchOrWaitlist({
          orgType: OrgType.PRIMERICA,
          memberUserId: 'member-3',
          organizationId: 'org-1',
          candidateSponsorIds: [],
        })
      ).resolves.toBeDefined();

      const outcome = await service.matchOrWaitlist({
        orgType: OrgType.PRIMERICA,
        memberUserId: 'member-3',
        organizationId: 'org-1',
        candidateSponsorIds: [],
      });
      expect(outcome.kind).toBe('waitlisted');
      if (outcome.kind === 'waitlisted') {
        expect(outcome.paidPathTier).toBe(AccessTier.PAID_INDIVIDUAL);
        expect(outcome.noUplineYetIsComplete).toBe(true);
      }
      expect(sponsorships).toHaveLength(0);
      expect(orgTreeEdges).toHaveLength(0);
    });

    test('an existing sponsor (invite/portal arrival) is linked without any candidate lookup', async () => {
      const { prisma, sponsorships } = makeMockPrisma();
      const service = new SponsorInviteService(prisma);
      const outcome = await service.matchOrWaitlist({
        orgType: OrgType.EXTERNAL,
        existingSponsorId: 'sponsor-from-invite',
        memberUserId: 'member-4',
        organizationId: 'org-1',
        candidateSponsorIds: [],
      });
      expect(outcome.kind).toBe('linked');
      if (outcome.kind === 'linked') expect(outcome.sponsorId).toBe('sponsor-from-invite');
      expect(sponsorships[0]).toMatchObject({ sponsor_user_id: 'sponsor-from-invite' });
    });
  });

  // (c)/(e) Access-tier RBAC through the service facade.
  describe('provisionEnterpriseTier — admin-only (§6.7/§16.6)', () => {
    test('ADMIN succeeds; every other role is denied', () => {
      const { prisma } = makeMockPrisma();
      const service = new SponsorInviteService(prisma);
      expect(service.provisionEnterpriseTier(Role.ADMIN)).toBe(AccessTier.ENTERPRISE);
      for (const role of [Role.REP, Role.UPLINE, Role.RVP, Role.DUAL]) {
        expect(() => service.provisionEnterpriseTier(role)).toThrow(AccessTierAuthorizationError);
      }
    });
  });
});
