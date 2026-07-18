// WP03 §8.2/§8.5 — the eligibility/exclusion boundary. This is the ONE place that decides whether a
// contact may ever enter the readiness ranking (and, downstream, the action queue) at all — the
// named WP03 critical failure this module exists specifically to prevent is "excluded-contact in
// queue": a do_not_contact / DO_NOT_CONTACT-pipeline-stage / minor / opted-out / state-unlicensed
// contact must never be ranked, scored, or surfaced as actionable, no matter what Layer 1-3 data
// exists for them.
//
// Three independent kinds of exclusion, all enforced HERE (not left to the caller to remember):
//   1. HARD exclusion (never queue, never rank) — do_not_contact, PipelineStage.DO_NOT_CONTACT,
//      is_minor_flag, or a hashed-identifier match in the global OptOutRegistry (§18.2 "opt-outs ...
//      propagate by hash"). A hard-excluded contact is dropped before readiness is even computed.
//   2. SOFT exclusion (§8.1 Layer 3 "flags immediate unsuitability e.g. an existing licensee") —
//      `existing_licensee_flag` on ContactMethodProfile. Per §8.2's Excluded-tier row ("informational
//      flag only; rep must acknowledge each with a tap"), a soft-excluded contact still lands in the
//      Excluded tier (visible, with an acknowledgment requirement) rather than being silently dropped
//      — the master spec's own distinction between a hard drop and a flagged-but-visible exclusion.
//   3. STATE-UNLICENSED exclusion (T-29R, §8.2's own Excluded-tier row "licensee/state-unlicensed/
//      minor") — `checkJurisdictionExclusion` below, combined by the caller (prioritized-queue.
//      service.ts) exactly the same way `existing_licensee_flag` is: it is NOT part of
//      `checkEligibility`'s own return value (this module's Contact-row-only/OptOutRegistry-only
//      surface stays narrow), but every caller that assembles the final `excluded` boolean must OR
//      it in. Regulated (Primerica) rep + a contact whose jurisdiction the rep is NOT LICENSED in
//      (via WP11's `LicensingService.getLicensedJurisdictions()`) => excluded; a rep with NO
//      licensing regime (universal/non-Primerica, §17.1) => this check is a no-op — never
//      over-excludes a rep who was never subject to state insurance licensing in the first place.

import { PipelineStage } from '@prisma/client';

/** The narrow Contact fields this boundary needs — never the full Contact row (WP02-owned model;
 *  this module reads it, never writes it). */
export interface EligibilityContactRow {
  id: string;
  do_not_contact: boolean;
  pipeline_stage: PipelineStage;
  is_minor_flag: boolean;
  phone_hash: string | null;
  email_hash: string | null;
}

/** Narrow OptOutRegistry read surface — DI-mockable (in-memory fake in tests, real Prisma delegate
 *  in production), mirroring every other narrow-Prisma-interface convention in this codebase. */
export interface OptOutLookupClient {
  findFirst(args: { where: { identifier_hash: { in: string[] } } }): Promise<{ identifier_hash: string } | null>;
}

export type HardExclusionReason =
  | 'do_not_contact'
  | 'do_not_contact_pipeline_stage'
  | 'minor'
  | 'opted_out'
  | 'unlicensed_jurisdiction';

export interface EligibilityResult {
  eligible: boolean;
  hardExclusionReason: HardExclusionReason | null;
}

/** The hard-exclusion check against the Contact row alone (no DB call — synchronous, cheap, and the
 *  first line of defense before the OptOutRegistry round-trip below). */
export function checkContactHardExclusion(contact: EligibilityContactRow): HardExclusionReason | null {
  if (contact.do_not_contact) return 'do_not_contact';
  if (contact.pipeline_stage === PipelineStage.DO_NOT_CONTACT) return 'do_not_contact_pipeline_stage';
  if (contact.is_minor_flag) return 'minor';
  return null;
}

/**
 * The full eligibility check (§18.2 "opt-outs ... propagate by hash"): Contact-level flags first
 * (synchronous, fail-fast — skips the OptOutRegistry round-trip entirely once already excluded),
 * then a global opt-out hash lookup across whichever of phone_hash/email_hash the contact has.
 * Fail-toward-caution (mirrors `minors.ts`'s doctrine): a contact with a match in EITHER hash is
 * excluded, never averaged/OR'd away.
 */
export async function checkEligibility(
  contact: EligibilityContactRow,
  optOutClient: OptOutLookupClient
): Promise<EligibilityResult> {
  const contactReason = checkContactHardExclusion(contact);
  if (contactReason) return { eligible: false, hardExclusionReason: contactReason };

  const hashes = [contact.phone_hash, contact.email_hash].filter((h): h is string => Boolean(h));
  if (hashes.length === 0) {
    return { eligible: true, hardExclusionReason: null };
  }

  const optOutHit = await optOutClient.findFirst({ where: { identifier_hash: { in: hashes } } });
  if (optOutHit) {
    return { eligible: false, hardExclusionReason: 'opted_out' };
  }
  return { eligible: true, hardExclusionReason: null };
}

// ─── T-29R — state-unlicensed exclusion (§8.2 "Excluded: state-unlicensed", §17.1 regulated-vs-
// universal) ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The per-rep context `checkJurisdictionExclusion` needs — assembled by the caller
 * (prioritized-queue.service.ts) ONCE per `getQueue()` call, not per contact, since both fields are
 * rep-level, not contact-level.
 */
export interface JurisdictionLicensingContext {
  /** True only for a rep subject to a state-licensing regime (the Primerica org branch —
   *  `isPrimericaBranch(orgType)`, mirroring org-gate.ts's regulated/universal split, §17.1). A
   *  universal rep (no licensing regime) makes this ENTIRE check a no-op below — this is what
   *  prevents the common naive-fail-closed failure mode of excluding every contact for a rep who was
   *  never subject to state insurance licensing to begin with. */
  regulated: boolean;
  /** The rep's currently LICENSED jurisdictions (`LicensingService.getLicensedJurisdictions()`).
   *  Deliberately treated identically whether it is empty because the rep truly holds no active
   *  license anywhere, or because the licensing lookup was unavailable/uncertain — both collapse to
   *  "cannot confirm this rep may licitly be matched with this contact," which is the fail-closed,
   *  deny-by-default posture this compliance boundary requires (a regulated rep must never have
   *  outreach drafted on unknown/absent licensure). Ignored entirely when `regulated` is false. */
  licensedJurisdictions: string[];
}

/** Narrow read surface onto WP11's `LicensingService` — DI-mockable (mirrors `OptOutLookupClient`
 *  above); `LicensingService` itself satisfies this directly via structural typing, so this module
 *  never needs to import the licensing service/module itself to stay narrow. */
export interface LicensedJurisdictionsProvider {
  getLicensedJurisdictions(userId: string): Promise<string[]>;
}

/** Uppercase/trim a jurisdiction code for comparison (mirrors the two-letter US state postal code
 *  convention documented on `LicensingRecord.jurisdiction`, src/types/licensing.ts) — a stray-case or
 *  whitespace difference between an imported Contact's state and a LicensingRecord's jurisdiction
 *  must never cause a false non-match at this compliance boundary. */
function normalizeJurisdiction(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * §8.2's "Excluded: state-unlicensed" tier / §8.1 eligibility, for one contact against one rep's
 * licensing context. Precedence, all fail-toward-caution at this compliance boundary:
 *   1. `!context.regulated` (universal rep, §17.1) => never excluded on this dimension — a rep with
 *      no licensing regime has nothing for this check to enforce (no over-exclusion).
 *   2. A regulated rep with an UNKNOWN contact jurisdiction (null/blank) => excluded. A regulated rep
 *      cannot be confirmed to be licensed "wherever this contact happens to be" when that location is
 *      unknown — deny-by-default, not assume-eligible-by-default.
 *   3. A regulated rep whose contact jurisdiction is known => excluded UNLESS that exact jurisdiction
 *      appears in `context.licensedJurisdictions` (which is `[]` — and therefore excludes everyone —
 *      whenever the rep's licensure is empty/unavailable, per `JurisdictionLicensingContext`'s own
 *      doc comment).
 */
export function checkJurisdictionExclusion(
  contactJurisdiction: string | null | undefined,
  context: JurisdictionLicensingContext
): 'unlicensed_jurisdiction' | null {
  if (!context.regulated) return null;

  const jurisdiction = normalizeJurisdiction(contactJurisdiction);
  if (!jurisdiction) return 'unlicensed_jurisdiction';

  const licensedSet = new Set(
    context.licensedJurisdictions.map((j) => normalizeJurisdiction(j)).filter((j): j is string => j !== null)
  );
  return licensedSet.has(jurisdiction) ? null : 'unlicensed_jurisdiction';
}
