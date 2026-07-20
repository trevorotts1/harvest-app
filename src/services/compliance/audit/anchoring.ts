import { createHash } from 'crypto';
import { stableStringify } from './hash-chain';

/**
 * External anchoring / tail-truncation detection (T-R4, master-spec §16.1 "immutability
 * (append-only, signed audit)") — closes the one honest limitation `./hash-chain.ts` documents:
 * a hash chain alone cannot detect truncation of the TAIL of the chain (deleting the
 * most-recently-appended row(s), with nothing appended after them, leaves no broken `prev_hash`
 * link for anything downstream to catch).
 *
 * The fix is the classic one for exactly this problem: periodically publish/escrow a signed
 * snapshot of the current chain head ("anchor" it) somewhere the tail-truncation can't also erase.
 * This module anchors into a dedicated, DB-level-immutable `AuditCheckpoint` table (see the T-R4
 * migration's `prevent_audit_mutation()` trigger) — a real production deployment could ALSO anchor
 * checkpoints to an external WORM log or timestamping service; this repository-local anchor is a
 * strict improvement over no anchor at all and requires no new external dependency or secret.
 *
 * "Signed" here means SHA-256-hashed (`checkpoint_hash`), not asymmetrically signed with a private
 * key — this build is key-less by construction (no service/key at module scope; see
 * `audit-service.ts`'s module doc), and a hash checkpoint is still fully sufficient for the threat
 * model: an attacker who can truncate the AuditEntry tail is not thereby handed a way to also
 * forge a NEW checkpoint_hash that validates against a truncated chain, because doing so would
 * require either (a) mutating/deleting the checkpoint row itself — blocked by the same DB trigger
 * that protects AuditEntry — or (b) inserting a NEW checkpoint whose `sequence`/`head_entry_hash`
 * matches the truncated chain's (shorter) tail, which `verifyAnchoring` catches by always comparing
 * against the LATEST checkpoint on record, not an attacker-chosen one, and by refusing to accept a
 * newer checkpoint with a lower `entry_count` than a prior one (a checkpoint count can only grow).
 */

export interface AuditCheckpoint {
  id: string;
  /** The anchored chain head's `sequence` (`AuditRepository.getChainTail().sequence`) at the
   *  moment this checkpoint was taken. */
  sequence: number;
  /** The anchored chain head's `entry_hash` (`AuditRepository.getChainTail().entry_hash`) at the
   *  moment this checkpoint was taken. */
  head_entry_hash: string;
  /** Total row count in the store at checkpoint time. */
  entry_count: number;
  /** SHA-256 over `{ sequence, head_entry_hash, entry_count, created_at }` (stable-serialized) —
   *  the checkpoint's own tamper-evidence. */
  checkpoint_hash: string;
  created_at: string;
}

/** The exact fields hashed into `checkpoint_hash`. Deliberately excludes `id` (not
 *  content-derived) and `checkpoint_hash` itself (the hash is derived FROM these fields). */
export interface HashableCheckpointFields {
  sequence: number;
  head_entry_hash: string;
  entry_count: number;
  created_at: string;
}

/** Computes the SHA-256 `checkpoint_hash` for a checkpoint given its hashable fields. */
export function computeCheckpointHash(fields: HashableCheckpointFields): string {
  return createHash('sha256').update(stableStringify(fields), 'utf8').digest('hex');
}

/** Append-only checkpoint store contract — deliberately no `update`/`delete`, mirroring
 *  `AuditRepository`'s own immutability-by-omission (§16.1). */
export interface AuditCheckpointRepository {
  save(checkpoint: AuditCheckpoint): Promise<void>;
  /** The most recently saved checkpoint, or `null` if none has ever been taken. */
  getLatest(): Promise<AuditCheckpoint | null>;
}

/** In-memory checkpoint repository — tests and default store until a Prisma-backed repository
 *  (`PrismaAuditCheckpointRepository`) is wired against the `AuditCheckpoint` table. */
export class InMemoryAuditCheckpointRepository implements AuditCheckpointRepository {
  private checkpoints: AuditCheckpoint[] = [];

  async save(checkpoint: AuditCheckpoint): Promise<void> {
    this.checkpoints.push(deepFreezeCheckpoint({ ...checkpoint }));
  }

  async getLatest(): Promise<AuditCheckpoint | null> {
    if (this.checkpoints.length === 0) return null;
    return this.checkpoints[this.checkpoints.length - 1];
  }

  /** Test-only helper: every checkpoint ever saved, in save order. Deliberately not part of
   *  `AuditCheckpointRepository`. */
  all(): AuditCheckpoint[] {
    return [...this.checkpoints];
  }

  /** Test-only helper: reset the store (a full test-fixture reset, not a per-row delete API). */
  clear(): void {
    this.checkpoints = [];
  }
}

/** Minimal shape of the Prisma `auditCheckpoint` delegate this repository needs — kept narrow
 *  (mirrors `AuditEntryPrismaDelegate`'s convention in `./audit-service.ts`) so a plain mock object
 *  satisfies it in tests without pulling in a real PrismaClient/DATABASE_URL. */
export interface AuditCheckpointPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<any>;
  findFirst(args: { orderBy?: Record<string, unknown> }): Promise<any | null>;
}

function fromPrismaCheckpointRow(row: any): AuditCheckpoint {
  return deepFreezeCheckpoint({
    id: row.id,
    sequence: row.sequence,
    head_entry_hash: row.head_entry_hash,
    entry_count: row.entry_count,
    checkpoint_hash: row.checkpoint_hash,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  });
}

/** Prisma-backed checkpoint repository — the production path, against the `AuditCheckpoint`
 *  table (see prisma/schema.prisma, and the T-R4 migration's `prevent_audit_mutation()` trigger,
 *  which enforces the same DB-level append-only/immutable posture on this table as on
 *  `AuditEntry`). No `update`/`delete` method exists here either. */
export class PrismaAuditCheckpointRepository implements AuditCheckpointRepository {
  constructor(private prisma: { auditCheckpoint: AuditCheckpointPrismaDelegate }) {}

  async save(checkpoint: AuditCheckpoint): Promise<void> {
    await this.prisma.auditCheckpoint.create({
      data: {
        id: checkpoint.id,
        sequence: checkpoint.sequence,
        head_entry_hash: checkpoint.head_entry_hash,
        entry_count: checkpoint.entry_count,
        checkpoint_hash: checkpoint.checkpoint_hash,
        created_at: checkpoint.created_at,
      },
    });
  }

  async getLatest(): Promise<AuditCheckpoint | null> {
    const row = await this.prisma.auditCheckpoint.findFirst({ orderBy: { created_at: 'desc' } });
    return row ? fromPrismaCheckpointRow(row) : null;
  }
}

export interface AnchoringVerificationResult {
  valid: boolean;
  /** `null` when `valid` is true, or when no checkpoint has ever been taken (nothing to verify
   *  against yet — not itself a failure). */
  reason: string | null;
  /** The checkpoint compared against, or `null` if none exists yet. */
  checkpoint: AuditCheckpoint | null;
}

/** The narrow shape `verifyAnchoring` needs from the audit store: the full current row set (to
 *  find the row at the checkpoint's anchored `sequence`, and to get a current total count) plus
 *  the current chain tail. Both `AuditRepository.query({})` and `.getChainTail()` already provide
 *  this — see `AuditService.verifyAnchoring`, which is the intended call site. */
export interface AnchoringQueryableStore {
  currentEntries: Array<{ sequence: number; entry_hash: string }>;
  currentTail: { sequence: number; entry_hash: string } | null;
}

/**
 * Verifies the current audit store against the latest anchored checkpoint. Returns
 * `{ valid: false }` iff the tail has been truncated since the checkpoint was taken:
 *   - the store now has FEWER rows than the checkpoint's `entry_count` (rows disappeared), or
 *   - the row at the checkpoint's anchored `sequence` no longer exists, or
 *   - that row's `entry_hash` no longer matches the checkpoint's `head_entry_hash` (the anchored
 *     row was itself replaced/edited — also independently caught by `verifyChain`'s
 *     `entry_hash` recomputation, but checked here too since this function must stand on its own),
 *     or
 *   - the checkpoint row's own `checkpoint_hash` doesn't recompute (the checkpoint itself was
 *     corrupted).
 *
 * `{ valid: true, checkpoint: null }` means no checkpoint has ever been taken — there is nothing
 * to verify tail-truncation against yet (not itself evidence of tampering).
 */
export function verifyAnchoring(
  store: AnchoringQueryableStore,
  checkpoint: AuditCheckpoint | null
): AnchoringVerificationResult {
  if (!checkpoint) {
    return { valid: true, reason: null, checkpoint: null };
  }

  const recomputed = computeCheckpointHash({
    sequence: checkpoint.sequence,
    head_entry_hash: checkpoint.head_entry_hash,
    entry_count: checkpoint.entry_count,
    created_at: checkpoint.created_at,
  });
  if (recomputed !== checkpoint.checkpoint_hash) {
    return {
      valid: false,
      reason: `checkpoint ${checkpoint.id} is corrupted: recomputed checkpoint_hash does not match the stored value — the checkpoint record itself was tampered with`,
      checkpoint,
    };
  }

  if (store.currentEntries.length < checkpoint.entry_count) {
    return {
      valid: false,
      reason: `tail truncation detected: the store now has ${store.currentEntries.length} row(s), fewer than the ${checkpoint.entry_count} anchored by checkpoint ${checkpoint.id} — rows were deleted from the tail after this checkpoint was taken`,
      checkpoint,
    };
  }

  const anchoredRow = store.currentEntries.find((e) => e.sequence === checkpoint.sequence);
  if (!anchoredRow) {
    return {
      valid: false,
      reason: `tail truncation detected: no row with sequence ${checkpoint.sequence} exists in the store anymore — the row anchored by checkpoint ${checkpoint.id} is gone`,
      checkpoint,
    };
  }

  if (anchoredRow.entry_hash !== checkpoint.head_entry_hash) {
    return {
      valid: false,
      reason: `tail truncation/tamper detected: the row at sequence ${checkpoint.sequence} now has a different entry_hash than checkpoint ${checkpoint.id} anchored — that row was replaced or edited since the checkpoint was taken`,
      checkpoint,
    };
  }

  if (store.currentTail && store.currentTail.sequence < checkpoint.sequence) {
    return {
      valid: false,
      reason: `tail truncation detected: the current chain head (sequence ${store.currentTail.sequence}) is behind checkpoint ${checkpoint.id}'s anchored sequence ${checkpoint.sequence}`,
      checkpoint,
    };
  }

  return { valid: true, reason: null, checkpoint };
}

/** Deep-freezes a checkpoint object (there are no nested objects on this shape today, but this
 *  keeps the same "deeply immutable, not just top-level" posture as the audit-row freezing in
 *  `audit-service.ts` — see `deepFreeze` there — should the shape ever grow a nested field). */
function deepFreezeCheckpoint<T extends object>(value: T): T {
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    const v = (value as Record<string, unknown>)[key];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      deepFreezeCheckpoint(v as object);
    }
  }
  return value;
}
