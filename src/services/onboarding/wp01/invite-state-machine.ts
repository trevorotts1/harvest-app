// WP01 §6.6 — the Upline invite state machine.
//
// "`sent → pending → accepted | rejected | expired`; `expired → sent` (re-send, max 3, ≤ 1 re-send
// per 24h). Invite email carries a one-time link `/onboarding/invite?invite_id={id}` that pre-seeds
// sponsor + org + role and skips sponsor matching. A daily job expires invites older than 7 days
// still in `sent`/`pending`. Modeled as `UplineInvite` (§3.3)."
//
// Reuses `InviteStatus`/`INVITE_EXPIRY_DAYS`/`MAX_INVITE_RESENDS` from `types/onboarding.ts` — those
// constants already exist there (unused until this unit) and match the Prisma-string values
// `prisma/schema.prisma`'s `UplineInvite.status` comment documents (`SENT | PENDING | ACCEPTED |
// REJECTED | EXPIRED`); this module does not re-declare a second, possibly-drifting copy.
//
// `recipient_email` note (ties to T-11 data-rights, §16.3): `src/services/compliance/data-rights/
// data-rights.ts` scrubs a deleted user's `UplineInvite.recipient_email` to `''` (never nulls it —
// the Prisma column is non-nullable). Every function below treats `recipient_email` as an opaque
// string and never assumes it is non-empty or email-shaped, so a scrubbed invite row is still a
// perfectly valid `UplineInviteRecord` to run a transition against (e.g. a daily-expiry sweep must
// still be able to expire an already-scrubbed invite).

import { InviteStatus, INVITE_EXPIRY_DAYS, MAX_INVITE_RESENDS } from '@/types/onboarding';
import { Role } from '@prisma/client';
import { can } from '@/lib/auth/rbac-matrix';

export { InviteStatus };

/** ≤ 1 re-send per 24h (§6.6). */
export const RESEND_COOLDOWN_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITE_EXPIRY_MS = INVITE_EXPIRY_DAYS * DAY_MS;
const RESEND_COOLDOWN_MS = RESEND_COOLDOWN_HOURS * 60 * 60 * 1000;

/** The Prisma-shaped `UplineInvite` row this module operates on (snake_case, matching prisma/schema.prisma). */
export interface UplineInviteRecord {
  id: string;
  sponsor_id: string;
  recipient_email: string;
  status: InviteStatus;
  /**
   * Doubles as "last (re-)sent at": a resend (`EXPIRED → SENT`) bumps this to `now`, restarting
   * both the 7-day expiry window and the 24h resend cooldown from the moment of the resend — the
   * schema has no separate `last_resent_at` column (§3.3's `UplineInvite` field list is exactly
   * `sponsor_id, recipient_email, status, created_at, responded_at, resend_count`), and "a fresh
   * invite email goes out" is naturally "this became a new SENT event", so reusing `created_at` for
   * that is the schema-consistent reading, not a new field.
   */
  created_at: Date;
  responded_at: Date | null;
  resend_count: number;
}

/** §6.6's transition graph. `ACCEPTED`/`REJECTED` are terminal — no transition leaves them. */
const ALLOWED_TRANSITIONS: Record<InviteStatus, readonly InviteStatus[]> = {
  [InviteStatus.SENT]: [InviteStatus.PENDING, InviteStatus.EXPIRED],
  [InviteStatus.PENDING]: [InviteStatus.ACCEPTED, InviteStatus.REJECTED, InviteStatus.EXPIRED],
  [InviteStatus.ACCEPTED]: [],
  [InviteStatus.REJECTED]: [],
  [InviteStatus.EXPIRED]: [InviteStatus.SENT], // the ONLY resurrection path: the capped resend
};

/** Pure graph check — does §6.6 allow `from → to` at all (independent of the guard conditions below)? */
export function canTransition(from: InviteStatus, to: InviteStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TransitionSuccess {
  readonly ok: true;
  readonly invite: UplineInviteRecord;
}
export interface TransitionFailure {
  readonly ok: false;
  readonly error: string;
}
export type TransitionResult = TransitionSuccess | TransitionFailure;

/**
 * Attempts `invite.status → to`. Guarded — an illegal transition (not in `ALLOWED_TRANSITIONS`) or
 * a transition whose extra §6.6 condition isn't met (7-day expiry not yet elapsed; resend cap
 * reached; resend attempted inside the 24h cooldown) is REJECTED (`ok: false`), never silently
 * coerced and never thrown — callers get a typed result either way.
 */
export function transitionInvite(
  invite: UplineInviteRecord,
  to: InviteStatus,
  now: Date = new Date()
): TransitionResult {
  const from = invite.status;

  if (!canTransition(from, to)) {
    return { ok: false, error: `Illegal invite transition: ${from} → ${to} (§6.6).` };
  }

  if (to === InviteStatus.EXPIRED) {
    const elapsed = now.getTime() - invite.created_at.getTime();
    if (elapsed < INVITE_EXPIRY_MS) {
      return {
        ok: false,
        error: `Invite is not yet eligible for expiry (${INVITE_EXPIRY_DAYS}-day window not elapsed).`,
      };
    }
    return { ok: true, invite: { ...invite, status: InviteStatus.EXPIRED } };
  }

  if (to === InviteStatus.SENT) {
    // Only reachable from EXPIRED per the transition graph — the capped, throttled resend.
    if (invite.resend_count >= MAX_INVITE_RESENDS) {
      return { ok: false, error: `Max resends (${MAX_INVITE_RESENDS}) already reached (§6.6).` };
    }
    const sinceLastSend = now.getTime() - invite.created_at.getTime();
    if (sinceLastSend < RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        error: `Resend cooldown active — at most 1 resend per ${RESEND_COOLDOWN_HOURS}h (§6.6).`,
      };
    }
    return {
      ok: true,
      invite: {
        ...invite,
        status: InviteStatus.SENT,
        created_at: now, // restarts the 7-day expiry window and the 24h cooldown, per the doc comment above
        resend_count: invite.resend_count + 1,
      },
    };
  }

  if (to === InviteStatus.ACCEPTED || to === InviteStatus.REJECTED) {
    return { ok: true, invite: { ...invite, status: to, responded_at: now } };
  }

  // to === PENDING (from SENT): the recipient opened the one-time link; no extra guard condition.
  return { ok: true, invite: { ...invite, status: to } };
}

/**
 * The daily expiry job (§6.6: "A daily job expires invites older than 7 days still in
 * `sent`/`pending`"). Pure and total: every invite in `invites` either transitions to `EXPIRED`
 * (7-day window elapsed) or is left untouched (not yet due, or already terminal/expired) — never
 * throws, and an invite this function skips is returned unchanged, not dropped.
 */
export function expireStaleInvites(
  invites: readonly UplineInviteRecord[],
  now: Date = new Date()
): { readonly invite: UplineInviteRecord; readonly expired: boolean }[] {
  return invites.map((invite) => {
    if (invite.status !== InviteStatus.SENT && invite.status !== InviteStatus.PENDING) {
      return { invite, expired: false };
    }
    const result = transitionInvite(invite, InviteStatus.EXPIRED, now);
    return result.ok ? { invite: result.invite, expired: true } : { invite, expired: false };
  });
}

// ─── Ties into the org tree on acceptance (§6.6 ↔ §3.3 OrgTreeEdge) ────────────────────────────

/** The `OrgTreeEdge` create payload produced the moment an invite transitions to `ACCEPTED`. */
export interface AcceptedInviteOrgTreeEdgeInsert {
  sponsor_id: string;
  recruit_id: string;
  edge_type: 'upline_sponsor';
  is_recruit_confirmed: true;
}

/**
 * Builds the org-tree edge an ACCEPTED invite produces, linking the invite's sponsor to the newly
 * onboarded recruit. Only valid to call once `invite.status === ACCEPTED` (the caller passes the
 * `TransitionSuccess.invite` from a `PENDING → ACCEPTED` transition); returns `null` otherwise so a
 * caller cannot accidentally wire a tree edge for a not-yet-accepted invite.
 */
export function buildOrgTreeEdgeFromAcceptedInvite(
  invite: UplineInviteRecord,
  recruitUserId: string
): AcceptedInviteOrgTreeEdgeInsert | null {
  if (invite.status !== InviteStatus.ACCEPTED) return null;
  return {
    sponsor_id: invite.sponsor_id,
    recruit_id: recruitUserId,
    edge_type: 'upline_sponsor',
    is_recruit_confirmed: true,
  };
}

// ─── RBAC (§16.6, via the T-19 `sponsor_invite` matrix resource) ───────────────────────────────

export class InviteAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteAuthorizationError';
  }
}

/** Pure role-capability check for sending/resending an invite — mirrors `can(role, 'sponsor_invite', 'write')`. */
export function canSendInvite(role: Role): boolean {
  return can(role, 'sponsor_invite', 'write');
}

/** Pure role-capability check for org-wide invite oversight (force-expire/audit someone else's invite). */
export function canManageAnyInvite(role: Role): boolean {
  return can(role, 'sponsor_invite', 'manage');
}

/**
 * The full §16.6 authorization a caller must satisfy to act on an invite: EITHER the actor holds
 * the org-wide `manage` grant (RVP/ADMIN), OR the actor is both role-capable of `write` AND the
 * invite's own sponsor. This is the "own vs. org-wide" row-level split the matrix module itself
 * documents as a service-layer concern (rbac-matrix.ts rule 3) — `sponsor_invite:write` alone would
 * let a REP send/resend an invite AS someone else's sponsor, which is not what "any rep can sponsor
 * their OWN downline" means. Fail-closed: throws for every other combination.
 */
export function assertInviteActionAuthorized(actorRole: Role, actorUserId: string, invite: UplineInviteRecord): void {
  if (canManageAnyInvite(actorRole)) return;
  if (canSendInvite(actorRole) && actorUserId === invite.sponsor_id) return;
  throw new InviteAuthorizationError(
    `Role '${actorRole}' (user ${actorUserId}) is not authorized to act on invite ${invite.id} (§6.6/§16.6).`
  );
}
