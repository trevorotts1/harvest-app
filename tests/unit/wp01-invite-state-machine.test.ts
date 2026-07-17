// WP01 §6.6 — the Upline invite state machine. Proves (b): legal transitions succeed, illegal
// transitions are rejected — including the 7-day expiry gate and the ≤3/≤1-per-24h resend cap.

import { Role } from '@prisma/client';

import {
  InviteAuthorizationError,
  InviteStatus,
  RESEND_COOLDOWN_HOURS,
  assertInviteActionAuthorized,
  buildOrgTreeEdgeFromAcceptedInvite,
  canManageAnyInvite,
  canSendInvite,
  canTransition,
  expireStaleInvites,
  transitionInvite,
  type UplineInviteRecord,
} from '../../src/services/onboarding/wp01/invite-state-machine';

function makeInvite(overrides: Partial<UplineInviteRecord> = {}): UplineInviteRecord {
  return {
    id: 'invite-1',
    sponsor_id: 'sponsor-1',
    recipient_email: 'recruit@example.com',
    status: InviteStatus.SENT,
    created_at: new Date('2026-07-01T00:00:00Z'),
    responded_at: null,
    resend_count: 0,
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('WP01 invite state machine — §6.6', () => {
  describe('the transition graph itself', () => {
    test('legal transitions per §6.6', () => {
      expect(canTransition(InviteStatus.SENT, InviteStatus.PENDING)).toBe(true);
      expect(canTransition(InviteStatus.SENT, InviteStatus.EXPIRED)).toBe(true);
      expect(canTransition(InviteStatus.PENDING, InviteStatus.ACCEPTED)).toBe(true);
      expect(canTransition(InviteStatus.PENDING, InviteStatus.REJECTED)).toBe(true);
      expect(canTransition(InviteStatus.PENDING, InviteStatus.EXPIRED)).toBe(true);
      expect(canTransition(InviteStatus.EXPIRED, InviteStatus.SENT)).toBe(true);
    });

    test('illegal transitions are rejected at the graph level', () => {
      expect(canTransition(InviteStatus.SENT, InviteStatus.ACCEPTED)).toBe(false); // must pass through PENDING
      expect(canTransition(InviteStatus.SENT, InviteStatus.REJECTED)).toBe(false);
      expect(canTransition(InviteStatus.ACCEPTED, InviteStatus.PENDING)).toBe(false); // terminal
      expect(canTransition(InviteStatus.REJECTED, InviteStatus.PENDING)).toBe(false); // terminal
      expect(canTransition(InviteStatus.ACCEPTED, InviteStatus.EXPIRED)).toBe(false);
      expect(canTransition(InviteStatus.PENDING, InviteStatus.SENT)).toBe(false); // only EXPIRED resurrects
    });
  });

  describe('transitionInvite — guarded transitions with real teeth', () => {
    test('SENT → PENDING succeeds (recipient opens the one-time link)', () => {
      const result = transitionInvite(makeInvite({ status: InviteStatus.SENT }), InviteStatus.PENDING);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.invite.status).toBe(InviteStatus.PENDING);
    });

    test('PENDING → ACCEPTED succeeds and stamps responded_at', () => {
      const now = new Date('2026-07-05T00:00:00Z');
      const result = transitionInvite(makeInvite({ status: InviteStatus.PENDING }), InviteStatus.ACCEPTED, now);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invite.status).toBe(InviteStatus.ACCEPTED);
        expect(result.invite.responded_at).toEqual(now);
      }
    });

    test('PENDING → REJECTED succeeds and stamps responded_at', () => {
      const now = new Date('2026-07-05T00:00:00Z');
      const result = transitionInvite(makeInvite({ status: InviteStatus.PENDING }), InviteStatus.REJECTED, now);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.invite.status).toBe(InviteStatus.REJECTED);
    });

    test('an illegal transition (SENT → ACCEPTED, skipping PENDING) is REJECTED, not coerced', () => {
      const invite = makeInvite({ status: InviteStatus.SENT });
      const result = transitionInvite(invite, InviteStatus.ACCEPTED);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/Illegal invite transition/);
    });

    test('ACCEPTED and REJECTED are terminal — every outbound transition is rejected', () => {
      for (const status of [InviteStatus.ACCEPTED, InviteStatus.REJECTED]) {
        for (const to of [InviteStatus.SENT, InviteStatus.PENDING, InviteStatus.ACCEPTED, InviteStatus.REJECTED, InviteStatus.EXPIRED]) {
          if (status === to) continue;
          const result = transitionInvite(makeInvite({ status }), to);
          expect(result.ok).toBe(false);
        }
      }
    });

    describe('EXPIRED is gated on the 7-day window (§6.6)', () => {
      test('SENT → EXPIRED before 7 days is REJECTED', () => {
        const created = new Date('2026-07-01T00:00:00Z');
        const tooSoon = new Date(created.getTime() + 3 * DAY_MS);
        const result = transitionInvite(makeInvite({ status: InviteStatus.SENT, created_at: created }), InviteStatus.EXPIRED, tooSoon);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/not yet eligible for expiry/);
      });

      test('SENT → EXPIRED at/after 7 days succeeds (the daily job)', () => {
        const created = new Date('2026-07-01T00:00:00Z');
        const dueDate = new Date(created.getTime() + 7 * DAY_MS);
        const result = transitionInvite(makeInvite({ status: InviteStatus.SENT, created_at: created }), InviteStatus.EXPIRED, dueDate);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.invite.status).toBe(InviteStatus.EXPIRED);
      });

      test('PENDING → EXPIRED follows the same 7-day gate', () => {
        const created = new Date('2026-07-01T00:00:00Z');
        const tooSoon = new Date(created.getTime() + 6 * DAY_MS);
        const result = transitionInvite(makeInvite({ status: InviteStatus.PENDING, created_at: created }), InviteStatus.EXPIRED, tooSoon);
        expect(result.ok).toBe(false);
      });
    });

    describe('EXPIRED → SENT — the capped, throttled resend (§6.6: max 3, ≤1/24h)', () => {
      test('a resend well past the 7-day expiry AND the 24h cooldown succeeds, bumping resend_count and resetting created_at', () => {
        const created = new Date('2026-07-01T00:00:00Z');
        const resendAt = new Date(created.getTime() + 8 * DAY_MS);
        const invite = makeInvite({ status: InviteStatus.EXPIRED, created_at: created, resend_count: 0 });
        const result = transitionInvite(invite, InviteStatus.SENT, resendAt);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.invite.status).toBe(InviteStatus.SENT);
          expect(result.invite.resend_count).toBe(1);
          expect(result.invite.created_at).toEqual(resendAt);
        }
      });

      test('resend is REJECTED inside the 24h cooldown (teeth: constructed EXPIRED invite whose last send was only 12h ago)', () => {
        const created = new Date('2026-07-01T00:00:00Z');
        const tooSoon = new Date(created.getTime() + 12 * 60 * 60 * 1000);
        const invite = makeInvite({ status: InviteStatus.EXPIRED, created_at: created, resend_count: 0 });
        const result = transitionInvite(invite, InviteStatus.SENT, tooSoon);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(new RegExp(`${RESEND_COOLDOWN_HOURS}h`));
      });

      test('resend is REJECTED at exactly the cap (resend_count already at 3, §6.6 "max 3")', () => {
        const created = new Date('2026-07-01T00:00:00Z');
        const wellPast = new Date(created.getTime() + 30 * DAY_MS);
        const invite = makeInvite({ status: InviteStatus.EXPIRED, created_at: created, resend_count: 3 });
        const result = transitionInvite(invite, InviteStatus.SENT, wellPast);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/Max resends/);
      });

      test('the 3rd resend (count 2 → 3) is still allowed — the cap is inclusive at exactly 3, not fewer', () => {
        const created = new Date('2026-07-01T00:00:00Z');
        const wellPast = new Date(created.getTime() + 30 * DAY_MS);
        const invite = makeInvite({ status: InviteStatus.EXPIRED, created_at: created, resend_count: 2 });
        const result = transitionInvite(invite, InviteStatus.SENT, wellPast);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.invite.resend_count).toBe(3);
      });
    });
  });

  describe('expireStaleInvites — the daily job (§6.6)', () => {
    test('expires every SENT/PENDING invite past 7 days; leaves fresher and terminal invites untouched', () => {
      const created = new Date('2026-07-01T00:00:00Z');
      const now = new Date(created.getTime() + 10 * DAY_MS);
      const invites: UplineInviteRecord[] = [
        makeInvite({ id: 'due-sent', status: InviteStatus.SENT, created_at: created }),
        makeInvite({ id: 'due-pending', status: InviteStatus.PENDING, created_at: created }),
        makeInvite({ id: 'fresh', status: InviteStatus.SENT, created_at: new Date(now.getTime() - DAY_MS) }),
        makeInvite({ id: 'already-accepted', status: InviteStatus.ACCEPTED, created_at: created }),
      ];
      const results = expireStaleInvites(invites, now);
      const byId = Object.fromEntries(results.map((r) => [r.invite.id, r]));

      expect(byId['due-sent'].expired).toBe(true);
      expect(byId['due-sent'].invite.status).toBe(InviteStatus.EXPIRED);
      expect(byId['due-pending'].expired).toBe(true);
      expect(byId['fresh'].expired).toBe(false);
      expect(byId['fresh'].invite.status).toBe(InviteStatus.SENT);
      expect(byId['already-accepted'].expired).toBe(false);
      expect(byId['already-accepted'].invite.status).toBe(InviteStatus.ACCEPTED);
    });

    test('is total over an empty list — never throws', () => {
      expect(() => expireStaleInvites([])).not.toThrow();
      expect(expireStaleInvites([])).toEqual([]);
    });
  });

  describe('ties into the org tree on acceptance (§6.6 ↔ §3.3 OrgTreeEdge)', () => {
    test('an ACCEPTED invite produces the sponsor → recruit OrgTreeEdge insert', () => {
      const accepted = makeInvite({ status: InviteStatus.ACCEPTED, sponsor_id: 'sponsor-9' });
      const edge = buildOrgTreeEdgeFromAcceptedInvite(accepted, 'new-recruit-1');
      expect(edge).toEqual({
        sponsor_id: 'sponsor-9',
        recruit_id: 'new-recruit-1',
        edge_type: 'upline_sponsor',
        is_recruit_confirmed: true,
      });
    });

    test('a NOT-yet-accepted invite produces no edge (never wires a tree edge early)', () => {
      expect(buildOrgTreeEdgeFromAcceptedInvite(makeInvite({ status: InviteStatus.PENDING }), 'x')).toBeNull();
      expect(buildOrgTreeEdgeFromAcceptedInvite(makeInvite({ status: InviteStatus.SENT }), 'x')).toBeNull();
    });
  });

  // (e) RBAC-gated invite management.
  describe('RBAC — who can send/manage invites (§16.6 sponsor_invite resource, teeth)', () => {
    test('every account-holding role can send its OWN invite (§15.3 "the RVP/leader/rep who underwrites")', () => {
      for (const role of [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN, Role.DUAL]) {
        expect(canSendInvite(role)).toBe(true);
      }
    });

    test('org-wide invite oversight (manage) is RVP/ADMIN only — REP/UPLINE/DUAL denied', () => {
      expect(canManageAnyInvite(Role.RVP)).toBe(true);
      expect(canManageAnyInvite(Role.ADMIN)).toBe(true);
      expect(canManageAnyInvite(Role.REP)).toBe(false);
      expect(canManageAnyInvite(Role.UPLINE)).toBe(false);
      expect(canManageAnyInvite(Role.DUAL)).toBe(false);
    });

    test('a REP acting on their OWN invite is authorized', () => {
      const invite = makeInvite({ sponsor_id: 'rep-1' });
      expect(() => assertInviteActionAuthorized(Role.REP, 'rep-1', invite)).not.toThrow();
    });

    test('a REP acting on SOMEONE ELSE\'S invite is DENIED (ownership check, not just role capability)', () => {
      const invite = makeInvite({ sponsor_id: 'rep-1' });
      expect(() => assertInviteActionAuthorized(Role.REP, 'rep-2', invite)).toThrow(InviteAuthorizationError);
    });

    test('RVP/ADMIN can act on an invite that is NOT their own (org-wide oversight)', () => {
      const invite = makeInvite({ sponsor_id: 'rep-1' });
      expect(() => assertInviteActionAuthorized(Role.RVP, 'rvp-9', invite)).not.toThrow();
      expect(() => assertInviteActionAuthorized(Role.ADMIN, 'admin-9', invite)).not.toThrow();
    });

    test('an UPLINE acting on someone else\'s invite is still denied (upline has write but not manage)', () => {
      const invite = makeInvite({ sponsor_id: 'rep-1' });
      expect(() => assertInviteActionAuthorized(Role.UPLINE, 'upline-9', invite)).toThrow(InviteAuthorizationError);
    });
  });
});
