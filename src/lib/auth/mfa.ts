import { Role } from '@prisma/client';

/**
 * MFA-capable hook points (T-04 scaffold).
 *
 * Master spec §16.4 requires MFA for `UPLINE`, `RVP`, and `ADMIN` (offered, not required, for
 * `REP`) and requires a step-up MFA challenge before five sensitive actions: billing changes,
 * data export, data delete, RBAC changes, and org switch (§16.4, §16.6 "Data-rights (own
 * export/delete) | yes (step-up MFA)"). The full TOTP/passkey/SMS-fallback verification flow is a
 * later unit (T-12) — this module is the single seam T-12 wires the real second-factor challenge
 * into. Every function below is a documented pass-through today; none of them block a request.
 *
 * The user-level enrollment flag (`User.mfa_enrolled` / `User.mfa_methods`, §3.2) already exists
 * on the Prisma schema from T-03 — this module is the session-layer half of the architecture:
 * where a per-session "has this session cleared a step-up challenge" flag lives and is read from.
 */

/** Roles for which §16.4 makes MFA enrollment mandatory (DUAL inherits UPLINE's requirement). */
export const MFA_REQUIRED_ROLES: readonly Role[] = [Role.UPLINE, Role.RVP, Role.ADMIN, Role.DUAL];

export function isMfaRequiredForRole(role: Role): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

/** The five §16.4 sensitive actions that require a step-up MFA challenge before they proceed. */
export type SensitiveAction =
  | 'billing_change'
  | 'data_export'
  | 'data_delete'
  | 'rbac_change'
  | 'org_switch';

export const SENSITIVE_ACTIONS: readonly SensitiveAction[] = [
  'billing_change',
  'data_export',
  'data_delete',
  'rbac_change',
  'org_switch',
];

/**
 * The minimal shape `requireStepUp` needs — deliberately not `next-auth`'s `Session` type, so this
 * module (and its tests) stay decoupled from the NextAuth request/response lifecycle. In practice
 * this is populated from `session.user.mfaEnrolled` / `session.user.mfaVerifiedAt`
 * (src/types/next-auth.d.ts), which are threaded through the `jwt`/`session` callbacks in
 * src/lib/auth/options.ts.
 */
export interface StepUpState {
  /** Mirrors `User.mfa_enrolled` — whether the account has at least one factor enrolled. */
  mfaEnrolled: boolean;
  /** Null until a real step-up challenge (T-12) marks this session verified. Always null today. */
  mfaVerifiedAt: string | null;
}

export class StepUpRequiredError extends Error {
  constructor(public readonly action: SensitiveAction) {
    super(
      `Step-up MFA is required before '${action}' (§16.4) — not yet enforced; T-12 hook point ` +
        '(src/lib/auth/mfa.ts requireStepUp).'
    );
    this.name = 'StepUpRequiredError';
  }
}

/**
 * HOOK POINT (T-12). Call this immediately before executing any of the five §16.4 sensitive
 * actions (billing change, data export/delete, RBAC change, org switch). Today it is intentionally
 * a no-op — there is no TOTP/passkey/SMS challenge surface yet to send the user to, so gating hard
 * here would be a dead end, not security. T-12 replaces the body with the real check: if the
 * action requires step-up and `state.mfaVerifiedAt` is not a recent, valid timestamp, redirect to
 * a challenge (or throw `StepUpRequiredError` from an API route) until it clears.
 *
 * Call-sites that will need this once T-12 lands: billing/subscription mutation handlers (WP10),
 * the data-rights export/delete endpoints (WP11 §16.3), any RBAC-role-change admin action, and the
 * org-switch flow (§16.6 "Cross-org visibility ... gated behind admin approval").
 */
export function requireStepUp(_state: StepUpState, _action: SensitiveAction): void {
  // T-12 implements the real gate here. See StepUpRequiredError for the shape the throw will take.
}
