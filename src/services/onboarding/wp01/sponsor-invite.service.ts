// WP01 T-19 — the orchestration layer wiring §6.5 sponsor matching + §6.6 the invite state machine
// to real `UplineInvite` / `Sponsorship` / `OrgTreeEdge` persistence.
//
// Follows this repo's established constructor-injection pattern for a narrow Prisma delegate shape
// (see `src/services/compliance/data-rights/data-rights.ts` / `src/services/warm-market/
// contact.service.ts`) — easy to satisfy with a plain in-memory mock in tests, no live database
// required. The pure decision logic itself (matching, transitions, tier assignment, event shape)
// lives in `sponsor-matching.ts` / `invite-state-machine.ts` / `access-tier.ts` /
// `downstream-contracts.ts`; this file is ONLY the persistence + RBAC wiring around those.

import { AccessTier, OrgType, Role } from '@prisma/client';

import {
  InviteStatus,
  UplineInviteRecord,
  assertInviteActionAuthorized,
  buildOrgTreeEdgeFromAcceptedInvite,
  canSendInvite,
  expireStaleInvites,
  InviteAuthorizationError,
  transitionInvite,
} from './invite-state-machine';
import {
  SponsorCandidate,
  SponsorMatchOutcome,
  buildOrgTreeEdgeInsert,
  buildSponsorshipInsert,
  matchSponsor,
} from './sponsor-matching';
import { adminProvisionEnterpriseTier } from './access-tier';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Narrow Prisma delegate shapes this service needs — enough surface to be satisfied by a plain
// mock object in tests, matching the constructor-injection pattern already used elsewhere.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface UplineInviteRow {
  id: string;
  sponsor_id: string;
  recipient_email: string;
  status: string;
  created_at: Date | string;
  responded_at: Date | string | null;
  resend_count: number;
}

export interface SponsorInvitePrismaClient {
  uplineInvite: {
    create(args: { data: Record<string, unknown> }): Promise<UplineInviteRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UplineInviteRow>;
    findUnique(args: { where: { id: string } }): Promise<UplineInviteRow | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<UplineInviteRow[]>;
  };
  sponsorship: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
  };
  orgTreeEdge: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
}

function dateOf(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toInviteRecord(row: UplineInviteRow): UplineInviteRecord {
  return {
    id: row.id,
    sponsor_id: row.sponsor_id,
    recipient_email: row.recipient_email,
    status: row.status as InviteStatus,
    created_at: dateOf(row.created_at),
    responded_at: row.responded_at ? dateOf(row.responded_at) : null,
    resend_count: row.resend_count,
  };
}

export class SponsorInviteService {
  constructor(private readonly prisma: SponsorInvitePrismaClient) {}

  // ── §6.6 invite lifecycle ──────────────────────────────────────────────────────────────────

  /** Creates a brand-new invite in `SENT`. RBAC-gated: the actor must hold `sponsor_invite:write` (§16.6). */
  async sendInvite(
    input: { actorRole: Role; actorUserId: string; recipientEmail: string },
    now: Date = new Date()
  ): Promise<UplineInviteRecord> {
    if (!canSendInvite(input.actorRole)) {
      throw new InviteAuthorizationError(
        `Role '${input.actorRole}' is not permitted to send a sponsor invite (§6.6/§16.6).`
      );
    }
    const row = await this.prisma.uplineInvite.create({
      data: {
        sponsor_id: input.actorUserId,
        recipient_email: input.recipientEmail,
        status: InviteStatus.SENT,
        created_at: now,
        responded_at: null,
        resend_count: 0,
      },
    });
    return toInviteRecord(row);
  }

  /** The recipient opens the one-time link: `SENT → PENDING`. */
  async markOpened(inviteId: string, now: Date = new Date()): Promise<UplineInviteRecord> {
    return this.applyTransition(inviteId, InviteStatus.PENDING, now);
  }

  /**
   * A capped, throttled resend: `EXPIRED → SENT` (max 3, ≤1/24h — enforced by
   * `transitionInvite`). RBAC-gated: only the invite's own sponsor (or RVP/ADMIN org-wide
   * oversight) may resend it.
   */
  async resendInvite(
    input: { actorRole: Role; actorUserId: string; inviteId: string },
    now: Date = new Date()
  ): Promise<UplineInviteRecord> {
    const invite = await this.loadInvite(input.inviteId);
    assertInviteActionAuthorized(input.actorRole, input.actorUserId, invite);
    return this.persistTransition(invite, InviteStatus.SENT, now);
  }

  /** Recipient accepts: `PENDING → ACCEPTED`, then wires the org-tree edge (§3.3 `OrgTreeEdge`). */
  async acceptInvite(
    inviteId: string,
    recruitUserId: string,
    now: Date = new Date()
  ): Promise<{ invite: UplineInviteRecord; orgTreeEdge: Record<string, unknown> }> {
    const invite = await this.loadInvite(inviteId);
    const accepted = await this.persistTransition(invite, InviteStatus.ACCEPTED, now);
    const edgeInsert = buildOrgTreeEdgeFromAcceptedInvite(accepted, recruitUserId);
    if (!edgeInsert) {
      // Structurally unreachable: persistTransition just proved accepted.status === ACCEPTED, and
      // buildOrgTreeEdgeFromAcceptedInvite only returns null when it is not. Guarded anyway so this
      // function is total and never silently drops the edge write.
      throw new Error(`Invite ${inviteId} did not reach ACCEPTED — no org-tree edge to create.`);
    }
    const orgTreeEdge = await this.prisma.orgTreeEdge.create({ data: { ...edgeInsert } });
    return { invite: accepted, orgTreeEdge };
  }

  /** Recipient declines: `PENDING → REJECTED`. */
  async rejectInvite(inviteId: string, now: Date = new Date()): Promise<UplineInviteRecord> {
    const invite = await this.loadInvite(inviteId);
    return this.persistTransition(invite, InviteStatus.REJECTED, now);
  }

  /** The daily expiry job (§6.6): expires every `SENT`/`PENDING` invite past the 7-day window. */
  async expireDueInvites(now: Date = new Date()): Promise<{ expiredCount: number; checkedCount: number }> {
    const candidates = await this.prisma.uplineInvite.findMany({
      where: { status: { in: [InviteStatus.SENT, InviteStatus.PENDING] } },
    });
    const records = candidates.map(toInviteRecord);
    const results = expireStaleInvites(records, now);

    let expiredCount = 0;
    for (const { invite, expired } of results) {
      if (!expired) continue;
      await this.prisma.uplineInvite.update({
        where: { id: invite.id },
        data: { status: invite.status },
      });
      expiredCount += 1;
    }
    return { expiredCount, checkedCount: records.length };
  }

  private async loadInvite(inviteId: string): Promise<UplineInviteRecord> {
    const row = await this.prisma.uplineInvite.findUnique({ where: { id: inviteId } });
    if (!row) throw new Error(`UplineInvite ${inviteId} not found`);
    return toInviteRecord(row);
  }

  private async applyTransition(inviteId: string, to: InviteStatus, now: Date): Promise<UplineInviteRecord> {
    const invite = await this.loadInvite(inviteId);
    return this.persistTransition(invite, to, now);
  }

  private async persistTransition(
    invite: UplineInviteRecord,
    to: InviteStatus,
    now: Date
  ): Promise<UplineInviteRecord> {
    const result = transitionInvite(invite, to, now);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const updated = await this.prisma.uplineInvite.update({
      where: { id: invite.id },
      data: {
        status: result.invite.status,
        created_at: result.invite.created_at,
        responded_at: result.invite.responded_at,
        resend_count: result.invite.resend_count,
      },
    });
    return toInviteRecord(updated);
  }

  // ── §6.5 sponsor matching ───────────────────────────────────────────────────────────────────

  /**
   * Matches a new member to a Downline Sponsor (or waitlists — never a dead end, §6.5). On a
   * `'linked'` outcome, persists the `Sponsorship` + `OrgTreeEdge` rows; on `'waitlisted'`,
   * persists nothing (there is nothing to persist yet) and simply returns the honest waitlist
   * outcome, which always carries the $297 path.
   */
  async matchOrWaitlist(
    input: {
      orgType: OrgType;
      existingSponsorId?: string | null;
      memberUserId: string;
      organizationId: string;
      /** Candidate sponsor user ids of the member's own org type; active-sponsorship load is looked up per candidate. */
      candidateSponsorIds: readonly string[];
    },
    now: Date = new Date()
  ): Promise<SponsorMatchOutcome> {
    const candidates: SponsorCandidate[] = await Promise.all(
      input.candidateSponsorIds.map(async (userId) => {
        const active = await this.prisma.sponsorship.findMany({
          where: { sponsor_user_id: userId, state: 'ACTIVE' },
        });
        return { userId, orgType: input.orgType, activeSponsorshipCount: active.length };
      })
    );

    const outcome = matchSponsor(
      { orgType: input.orgType, existingSponsorId: input.existingSponsorId, candidates },
      now
    );

    if (outcome.kind === 'linked') {
      const sponsorshipInsert = buildSponsorshipInsert(outcome, input.memberUserId, input.organizationId);
      const edgeInsert = buildOrgTreeEdgeInsert(outcome, input.memberUserId);
      // Structurally unreachable (outcome.kind === 'linked' guarantees both builders return
      // non-null), guarded so persistence never silently no-ops on a linked match.
      if (!sponsorshipInsert || !edgeInsert) {
        throw new Error('Linked sponsor match produced no Sponsorship/OrgTreeEdge payload.');
      }
      await this.prisma.sponsorship.create({ data: { ...sponsorshipInsert } });
      await this.prisma.orgTreeEdge.create({ data: { ...edgeInsert } });
    }

    return outcome;
  }

  // ── §6.7 the one manual tier action ────────────────────────────────────────────────────────

  /** Admin-only manual enterprise provisioning (§6.7) — RBAC-gated by `adminProvisionEnterpriseTier`. */
  provisionEnterpriseTier(actorRole: Role): AccessTier {
    return adminProvisionEnterpriseTier(actorRole);
  }
}
