// T-22 (§18.5 "minors/sensitive contacts... never reachable"; §7.6 "minors/sensitive contacts
// (flagged/detectable) → excluded from outreach... recorded in OptOutRegistry with reason minor";
// QC WP02 critical failure #3 "minor contact reachable by any outreach path") — the minors gate
// applied AT INGESTION, before a Contact row is ever created or merged.
//
// A minor's Contact row IS retained in the Vault (§7.6: "easy exclusion during segmentation" implies
// the contact is visible, just excluded from outreach — it is not silently dropped from the rep's
// address book). What is enforced here is that the row can never become outreach-eligible:
// `VaultService.upsertRow` (vault.service.ts) sets `is_minor_flag`/`do_not_contact`/`pipeline_stage
// = DO_NOT_CONTACT` on any row this module flags, and separately registers the contact's hashed
// identifiers in the global `OptOutRegistry` (reason `minor`) — the same registry every outbound
// send path (WP05) is required to check before dispatch (§3.4 "opt-out precedence").

import type { RawContactImportRow } from '../../../types/warm-market';

/** §18.5/§7.6: the age threshold below which a contact is a minor and excluded from outreach. */
export const MINOR_AGE_THRESHOLD_YEARS = 18;

/**
 * Age in whole years as of `now` (defaults to the real current time). Returns `NaN` for an
 * unparseable birthdate — callers must treat `NaN` as "cannot determine age", never as "not a
 * minor" (fail toward caution, mirroring the CFE's "classifier disagreement → higher risk band").
 */
export function ageYearsFrom(birthdateIso: string, now: Date = new Date()): number {
  const birthdate = new Date(birthdateIso);
  if (Number.isNaN(birthdate.getTime())) return NaN;

  let age = now.getFullYear() - birthdate.getFullYear();
  const monthDiff = now.getMonth() - birthdate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthdate.getDate())) {
    age--;
  }
  return age;
}

/**
 * Is this import row a minor? Two independent detection paths, either sufficient (fail toward
 * caution — an unparseable/ambiguous birthdate is NOT treated as "adult"):
 *   1. `isMinor === true` — an explicitly flagged/detectable minor (§7.6 "flagged/detectable"), e.g.
 *      a mapped CSV column or a client-side native-contacts heuristic.
 *   2. A parseable `birthdate` yielding an age under `MINOR_AGE_THRESHOLD_YEARS`.
 * No signal at all (no flag, no birthdate) → not a minor (§7.6 default: adults are not assumed
 * minors absent a positive signal — the platform cannot fabricate an age it was never given).
 */
export function isMinorRow(row: Pick<RawContactImportRow, 'isMinor' | 'birthdate'>, now: Date = new Date()): boolean {
  if (row.isMinor === true) return true;
  if (row.birthdate) {
    const age = ageYearsFrom(row.birthdate, now);
    if (Number.isNaN(age)) return true; // fail toward caution: an unparseable birthdate never clears the gate
    if (age < MINOR_AGE_THRESHOLD_YEARS) return true;
  }
  return false;
}
