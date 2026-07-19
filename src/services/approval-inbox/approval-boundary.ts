// T-33 (WP04 Approval Inbox, master-spec §9.2/§9.9-2/§9.9-3; uiux §5.6 "Batch operations do not
// exist by design ... an 'approve all' affordance must never ship") — the NO-BATCH-APPROVE rule,
// enforced ARCHITECTURALLY, the same way T-27's action-boundary.ts blocks the WP03 §8.5
// anti-patterns: by rejecting a caller's REQUEST SHAPE before it ever reaches the approval-inbox
// service, so a batch/array approve attempt fails by construction, every time, rather than being
// merely "not currently wired up" (which a future refactor could silently start honoring).
//
// This is deliberately a SECOND, independent layer on top of the route/service contract itself
// (`approveDraft(userId, draftId: string)` — no plural, no array parameter exists anywhere on the
// call chain). The guard below exists so an attempt to smuggle a batch shape past the route is an
// explicit, testable 400 rejection — not just an absence that happens to work because nothing reads
// the extra field.

export type BlockedApprovalAntiPattern = 'batch_approve';

export class ApprovalAntiPatternBlockedError extends Error {
  constructor(
    public readonly antiPattern: BlockedApprovalAntiPattern,
    message: string
  ) {
    super(message);
    this.name = 'ApprovalAntiPatternBlockedError';
  }
}

// Case-insensitive, one-level-nested scan — same scope discipline as T-27's action-boundary.ts:
// same keys, case-insensitive, one level of nesting. No open-ended semantic synonym widening.
function findBatchApproveHit(
  obj: Record<string, unknown>,
  depth = 0
): { key: string; reason: string } | undefined {
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (lower === 'draftid' && Array.isArray(value)) {
      return { key, reason: '"draftId" must be a single id, not an array' };
    }
    if (lower === 'draftids') {
      return { key, reason: '"draftIds" (plural) is not an accepted field' };
    }
    if (lower === 'ids' && Array.isArray(value)) {
      return { key, reason: '"ids" (array) is not an accepted field' };
    }
  }
  if (depth === 0) {
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = findBatchApproveHit(value as Record<string, unknown>, depth + 1);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

/**
 * §9.9-3/uiux AC-5.6-2 "no batch-approve affordance exists": rejects (never silently strips) a
 * batch/array-shaped approve (or decline/edit) payload — a plural `draftIds` field, or a
 * `draftId`/`ids` field carrying an array — before the approval-inbox service ever runs. Every
 * approval-inbox mutation route calls this FIRST, exactly where T-27's `rejectBatchPayload` is
 * called first on the action-queue routes.
 */
export function rejectBatchApprove(body: Record<string, unknown> | null | undefined): void {
  if (!body || typeof body !== 'object') return;
  const hit = findBatchApproveHit(body);
  if (!hit) return;
  throw new ApprovalAntiPatternBlockedError(
    'batch_approve',
    `${hit.reason} — approval is strictly per-item; a batch/"approve all" affordance is an ` +
      'architectural anti-pattern and does not exist on this route (§9.2/§9.9-3, uiux AC-5.6-2).'
  );
}
