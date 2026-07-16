// WP01 §6.7 — Access-tier assignment.
//
// "Assigned at registration from auth source + org context: email/password no sponsor →
// free_paid_external; email/password with sponsor invite or Primerica-portal OAuth →
// free_org_linked; admin provisioning → enterprise; post-subscription upgrade → paid_individual.
// On `gated_complete`, WP01 publishes `user_id + access_tier` to WP10's subscription-init queue
// (§15)."
//
// This is the CONTRACT WP10 payments provisioning consumes (§15.2): "WP10 provisions from
// `access_tier` ... WP10 must not provision before this event". Getting this exactly right —
// the real Prisma `AccessTier` enum, never a legacy/local shape, never a `$49`/`$199`-era value —
// is the whole point of this module. See `downstream-contracts.ts` for how the assigned tier is
// carried onward in the `user.onboarding_completed` payload WP10 reads.
//
// Deliberately does NOT import Prisma or touch the database — this is the pure decision function,
// exactly like `../roles.ts`/`../org-gate.ts` (T-17) are pure. Persistence (writing
// `User.access_tier`) is the caller's job (see `sponsor-invite.service.ts` for the one place this
// repo wires it to a narrow Prisma-shaped interface).

import { AccessTier } from '@prisma/client';
import { Role } from '@prisma/client';

import { can } from '@/lib/auth/rbac-matrix';

// ─── The five §6.7 registration paths (one literal per spec branch) ────────────────────────────

/**
 * The exhaustive set of §6.7 registration-time paths. Each maps to EXACTLY one `AccessTier` — see
 * `assignAccessTier`. Named after the spec's own branch language so a reviewer can match this type
 * to §6.7 line-by-line:
 *
 *   - `email_password_no_sponsor`            → free_paid_external
 *   - `email_password_with_sponsor`          → free_org_linked ("with sponsor invite")
 *   - `primerica_portal_oauth`               → free_org_linked (the portal implies org sponsorship)
 *   - `admin_provisioning`                   → enterprise
 *   - `post_subscription_upgrade`            → paid_individual
 */
export type RegistrationPath =
  | 'email_password_no_sponsor'
  | 'email_password_with_sponsor'
  | 'primerica_portal_oauth'
  | 'admin_provisioning'
  | 'post_subscription_upgrade';

/**
 * The §6.7 assignment rule, exhaustive over `RegistrationPath`. Pure and total: every path produces
 * a real Prisma `AccessTier` value; there is no path that can produce `undefined`/`null`/a
 * non-enum string, and no path ever produces a `$49`/`$199`-era value (those values do not exist in
 * the `AccessTier` enum at all — see prisma/schema.prisma §3.1 — so this function cannot produce
 * them even in error).
 */
export function assignAccessTier(path: RegistrationPath): AccessTier {
  switch (path) {
    case 'email_password_no_sponsor':
      return AccessTier.FREE_PAID_EXTERNAL;
    case 'email_password_with_sponsor':
    case 'primerica_portal_oauth':
      return AccessTier.FREE_ORG_LINKED;
    case 'admin_provisioning':
      return AccessTier.ENTERPRISE;
    case 'post_subscription_upgrade':
      return AccessTier.PAID_INDIVIDUAL;
    default: {
      // Fail-closed for any value outside the union (defensive; TS exhausts it above).
      const _exhaustive: never = path;
      throw new Error(`assignAccessTier: unrecognized registration path ${String(_exhaustive)}`);
    }
  }
}

// ─── Resolving the raw registration signals into a single `RegistrationPath` ───────────────────

export interface RegistrationSignals {
  /** How the account authenticates. Primerica-portal OAuth is its own signal per §6.7. */
  authMethod: 'email_password' | 'primerica_portal_oauth';
  /**
   * Whether a sponsor is already linked at registration time — either because the rep arrived
   * under an `UplineInvite` (§6.6) or because §6.5's automated matching found one. Both count as
   * "with sponsor invite" for §6.7's purposes (see `sponsor-matching.ts`'s `linked` outcome, which
   * is the only outcome that should ever set this `true`).
   */
  sponsorLinked: boolean;
  /** Set true only for the ADMIN-provisioned enterprise path (§6.7, gated — see `access_tier_assignment` in rbac-matrix.ts). */
  adminProvisioned?: boolean;
  /** Set true only when this assignment is happening at a post-subscription upgrade point, not initial registration. */
  subscriptionUpgrade?: boolean;
}

/**
 * Resolves the raw signals a caller has on hand into exactly one §6.7 `RegistrationPath`, with a
 * fail-closed precedence order: an explicit admin-provisioning or subscription-upgrade signal
 * always wins over the ambient auth/sponsor signals (those two are deliberate, single-purpose
 * calls — see `adminProvisionEnterpriseTier` below — never a side effect of ordinary registration).
 */
export function resolveRegistrationPath(signals: RegistrationSignals): RegistrationPath {
  if (signals.adminProvisioned) return 'admin_provisioning';
  if (signals.subscriptionUpgrade) return 'post_subscription_upgrade';
  if (signals.authMethod === 'primerica_portal_oauth') return 'primerica_portal_oauth';
  if (signals.sponsorLinked) return 'email_password_with_sponsor';
  return 'email_password_no_sponsor';
}

/** Convenience one-shot: resolve signals straight to the assigned tier. */
export function assignAccessTierFromSignals(signals: RegistrationSignals): AccessTier {
  return assignAccessTier(resolveRegistrationPath(signals));
}

// ─── RBAC-gated manual admin provisioning (§6.7's ONE role-gated tier action) ──────────────────

export class AccessTierAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessTierAuthorizationError';
  }
}

/** Pure capability check — mirrors `can(role, 'access_tier_assignment', 'manage')` for callers that don't have a full session. */
export function canProvisionEnterpriseTier(role: Role): boolean {
  return can(role, 'access_tier_assignment', 'manage');
}

/**
 * The ONLY manual tier-assignment action §6.7 names: "admin provisioning → enterprise". Fail-closed
 * — throws for any role but ADMIN (§16.6 `access_tier_assignment` row, RVP included in the deny
 * set: §6.7 names exactly "admin", no RVP exception, unlike most §16.6 rows). Every other tier
 * outcome is a system computation (`assignAccessTier`/`assignAccessTierFromSignals`), never gated
 * by a role check, because no role is "acting" to produce it.
 */
export function adminProvisionEnterpriseTier(actorRole: Role): AccessTier {
  if (!canProvisionEnterpriseTier(actorRole)) {
    throw new AccessTierAuthorizationError(
      `Role '${actorRole}' is not permitted to provision the enterprise tier (§6.7 — admin only).`
    );
  }
  return assignAccessTier('admin_provisioning');
}

// ─── WP10 provisioning reference metadata (§0.2/§15.1 locked pricing) ──────────────────────────

/**
 * The locked-pricing cents value WP10 provisions against for each tier (§0.2/§15.1: "$0 sponsored
 * / $297 per month / $25,000 per year" — the `$49`/`$199` baseline tiers are void everywhere).
 * `FREE_PAID_EXTERNAL` is also $0 to the member at assignment time (§15.1: "free subscription with
 * an upgrade upsell at first login" — the upsell is a later `post_subscription_upgrade`
 * transition to `PAID_INDIVIDUAL`, not a price on this tier itself). Kept here (not in WP10) so
 * this module — the §6.7 contract's single source — is also the single source for "what does this
 * tier cost", and a QC sweep for a stray `$49`/`$199` has exactly one table to check against for
 * WP01's half of that constraint.
 */
export const ACCESS_TIER_PRICE_CENTS: Readonly<Record<AccessTier, number>> = Object.freeze({
  [AccessTier.FREE_ORG_LINKED]: 0,
  [AccessTier.FREE_PAID_EXTERNAL]: 0,
  [AccessTier.PAID_INDIVIDUAL]: 29_700, // $297/mo
  [AccessTier.ENTERPRISE]: 2_500_000, // $25,000/yr
});
