import { createHash } from 'crypto';

/**
 * Tamper-evidence primitives for the immutable audit store (T-10, master-spec §5.6/§16.1).
 *
 * §16.1 names "immutability (append-only, signed audit)" as a core compliance-as-infrastructure
 * principle. This module is the "signed" half: every `AuditEntry` row stores a SHA-256
 * `entry_hash` computed over its own content plus the previous row's `entry_hash` (`prev_hash`),
 * forming a hash chain (the same structure underlying every tamper-evident ledger design). The
 * append-only half — no update/delete API exists anywhere on the repository/service — lives in
 * `audit-service.ts`.
 *
 * Why this actually catches tampering:
 *  - Mutating a row's content without recomputing its `entry_hash` is caught immediately:
 *    `verifyChain` recomputes the hash from the row's current content and it will not match the
 *    stored `entry_hash`.
 *  - Mutating a row's content AND recomputing a self-consistent `entry_hash` to hide the edit
 *    breaks the link to the NEXT row instead: that row's `prev_hash` was fixed at write time to
 *    the OLD `entry_hash` and no longer matches, so the discontinuity is still caught. Hiding the
 *    tamper entirely would require rewriting every subsequent row's hash to the end of the chain —
 *    there is no code path that can do that (no update API exists at all, §5.6/§16.1).
 *  - Deleting a row is caught the same way: the next remaining row's `prev_hash` no longer matches
 *    any hash actually present in the chain, and/or the `sequence` numbering (a monotonic
 *    autoincrement, independent of wall-clock `created_at`) shows a gap.
 *
 * Honest limitation (documented, not hidden): a hash chain alone cannot detect truncation of the
 * TAIL of the chain (deleting the most-recent row(s) with nothing appended after them) — there is
 * no "next row" whose link would break. Defending against that requires an externally anchored
 * checkpoint (periodically publishing/escrowing the current chain head, e.g. to a separate WORM
 * log or timestamping service) — out of this build's scope, but `AuditRepository.getChainTail()`
 * and `AuditService.getChainHead()` exist precisely so that anchoring job can be added later
 * without changing this module's contract.
 */

/** The `prev_hash` of the very first entry ever appended (no predecessor exists). */
export const GENESIS_PREV_HASH: string | null = null;

/** The exact fields hashed into `entry_hash`. Deliberately excludes `entry_hash` itself (the hash
 *  is derived FROM these fields, not part of its own input) but includes `prev_hash` (that's what
 *  chains this entry to its predecessor). */
export interface HashableEntryFields {
  id: string;
  sequence: number;
  user_id: string;
  content_id: string | null;
  content_text: string;
  content_hash: string;
  channel: string | null;
  risk_score: number;
  outcome: string;
  classifier_data: unknown;
  rule_version: string;
  regulation: string;
  reviewer_id: string | null;
  reviewer_action: string | null;
  role: string;
  created_at: string;
}

/**
 * Deterministic JSON serialization: object keys are sorted recursively so the same logical content
 * always produces the same byte string regardless of key-insertion order (JS object key order is
 * usually stable, but a hash function must not rely on "usually" — this makes it exact).
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
  return `{${entries.join(',')}}`;
}

/** Computes the SHA-256 `entry_hash` for a row given its hashable fields and its `prev_hash`. */
export function computeEntryHash(fields: HashableEntryFields, prevHash: string | null): string {
  const payload = stableStringify({ ...fields, prev_hash: prevHash });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export interface ChainVerificationResult {
  valid: boolean;
  /** Index (in sequence order) of the first row where verification failed, or null if valid. */
  brokenAtIndex: number | null;
  /** `id` of the first row where verification failed, or null if valid. */
  brokenEntryId: string | null;
  /** Human-readable reason, or null if valid. */
  reason: string | null;
}

/**
 * Re-verifies an entire hash chain from a list of rows (order-independent input — this sorts by
 * `sequence` itself). Returns `{ valid: true }` iff:
 *   1. `sequence` numbers are contiguous starting at the first row's own sequence (no gaps —
 *      catches a deleted row, including one deleted from the middle);
 *   2. each row's `prev_hash` equals the previous row's `entry_hash`, and the first row's
 *      `prev_hash` is `GENESIS_PREV_HASH` (catches a deleted/reordered/rootless row);
 *   3. each row's `entry_hash` recomputes to the same value from its current content (catches a
 *      mutated row).
 */
export type ChainedEntry = HashableEntryFields & { prev_hash: string | null; entry_hash: string };

export function verifyChain(entries: ChainedEntry[]): ChainVerificationResult {
  const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);

  let expectedPrevHash: string | null = GENESIS_PREV_HASH;
  let expectedSequence: number | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];

    if (expectedSequence !== null && row.sequence !== expectedSequence) {
      return {
        valid: false,
        brokenAtIndex: i,
        brokenEntryId: row.id,
        reason: `sequence gap before entry ${row.id}: expected sequence ${expectedSequence}, found ${row.sequence} — a row was deleted or reordered`,
      };
    }

    if (row.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        brokenAtIndex: i,
        brokenEntryId: row.id,
        reason: `prev_hash mismatch at entry ${row.id}: chain link to its predecessor is broken (predecessor deleted, reordered, or this row forged)`,
      };
    }

    const { entry_hash, prev_hash, ...hashable } = row;
    const recomputed = computeEntryHash(hashable, prev_hash);
    if (recomputed !== entry_hash) {
      return {
        valid: false,
        brokenAtIndex: i,
        brokenEntryId: row.id,
        reason: `entry_hash mismatch at entry ${row.id}: recomputed hash does not match the stored hash — this row's content was mutated after being written`,
      };
    }

    expectedPrevHash = row.entry_hash;
    expectedSequence = row.sequence + 1;
  }

  return { valid: true, brokenAtIndex: null, brokenEntryId: null, reason: null };
}
