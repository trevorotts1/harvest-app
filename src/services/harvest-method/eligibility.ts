// WP03 §8.2/§8.5 — the eligibility/exclusion boundary. This is the ONE place that decides whether a
// contact may ever enter the readiness ranking (and, downstream, the action queue) at all — the
// named WP03 critical failure this module exists specifically to prevent is "excluded-contact in
// queue": a do_not_contact / DO_NOT_CONTACT-pipeline-stage / minor / opted-out contact must never
// be ranked, scored, or surfaced as actionable, no matter what Layer 1-3 data exists for them.
//
// Two independent kinds of exclusion, both enforced HERE (not left to the caller to remember):
//   1. HARD exclusion (never queue, never rank) — do_not_contact, PipelineStage.DO_NOT_CONTACT,
//      is_minor_flag, or a hashed-identifier match in the global OptOutRegistry (§18.2 "opt-outs ...
//      propagate by hash"). A hard-excluded contact is dropped before readiness is even computed.
//   2. SOFT exclusion (§8.1 Layer 3 "flags immediate unsuitability e.g. an existing licensee") —
//      `existing_licensee_flag` on ContactMethodProfile. Per §8.2's Excluded-tier row ("informational
//      flag only; rep must acknowledge each with a tap"), a soft-excluded contact still lands in the
//      Excluded tier (visible, with an acknowledgment requirement) rather than being silently dropped
//      — the master spec's own distinction between a hard drop and a flagged-but-visible exclusion.

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

export type HardExclusionReason = 'do_not_contact' | 'do_not_contact_pipeline_stage' | 'minor' | 'opted_out';

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
