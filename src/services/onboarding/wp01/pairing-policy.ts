// R-01 (refinements catalog 2026-07-28) — the RVP no-pairing policy, as a single role-keyed
// decision module.
//
// Business rule (operator-confirmed): "In Primerica, once someone reaches RVP they own their own
// organization — they don't necessarily report to an upper line; people report to THEM, and an RVP
// is equipped to handle anyone in their own downline. They generally keep in touch with their
// SVP/promoter, but that's a courtesy link, not a supervisory/pairing requirement."
//
//   - RVP: never auto-paired, never required to name an immediate upline (name or upline solution
//     ID all OPTIONAL / skippable). The UI must state clearly that as an RVP they are not being
//     paired with anyone. Upline linkage stays OPTIONAL: an RVP MAY name their SVP/promoter if
//     that person is on the platform — allowed, never required — but that upline does not "step
//     in" or supervise.
//   - Levels BELOW RVP (REP/UPLINE/DUAL rep-side/upline-side): the normal required upline pairing
//     is UNCHANGED.
//
// This module is the single source of truth both the registration wizard
// (`src/app/auth/page.tsx` — the form that actually captures pairing) and the onboarding flow
// (`src/app/onboarding/OnboardingFlow.tsx` — the sponsor/upline step) consult, so the rule can
// never drift between surfaces. Pure decision logic only — no Prisma import, no React import,
// matching `../roles.ts`/`../org-gate.ts`/`sponsor-matching.ts` (T-17).

import { Role } from '@prisma/client';

/**
 * Should this role's pairing/upline capture be REQUIRED? Only roles below RVP keep the normal
 * required pairing. An RVP is never required to name anyone — nothing in the registration wizard
 * or the sponsor/upline step may block RVP progress on a missing upline (name or solution ID).
 *
 * Fail-closed on unknown values: an unrecognized role resolves to `true` (required) — the
 * pre-existing behavior for every real role below RVP, and never a way to silently skip the
 * pairing requirement for a role the policy does not enumerate.
 */
export function pairingRequiredForRole(role: Role): boolean {
  return role !== Role.RVP;
}

/**
 * Should this role's sponsor/upline STEP be SKIPPED entirely in the onboarding flow? Only RVP —
 * "do NOT auto-pair them with anyone" — the rep-track sponsor-matching screen (which exists to
 * pair a downline rep with a Downline Sponsor) is not offered to an RVP at all. REP and every
 * other role keep the step exactly as before.
 */
export function sponsorStepSkippedForRole(role: Role): boolean {
  return role === Role.RVP;
}
