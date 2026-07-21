// T-54 (master-spec §17.6 "Offline-first & degraded operation"; uiux §6.4 "Queue-and-sync with
// re-validation" / §4.3 Approval Inbox Item "queued-offline" state) — offline local-queue wiring
// SPECIFIC to the standalone Approval Inbox (`src/app/inbox/page.tsx`). Framework-free (no React
// import), built on the codebase-wide primitives in `src/lib/offline/*` (storage, online-status,
// the persisted queue — T-R11), following the exact same shape
// `src/app/ritual/warm-market/offline.ts` already established for the Warm-Market Ritual: this
// module owns the storage key, the mutation-kind vocabulary, and the `replay()` handler map: the
// PAGE owns only the React glue (state, effects).
//
// CFE RE-VALIDATION ON RECONNECT (master-spec §17.6, the critical invariant this build unit closes):
// the EDIT handler below dispatches to the real `POST /api/approval-inbox/edit` route — i.e.
// `ApprovalInboxService.editDraft` — which UNCONDITIONALLY re-enters the CFE against the new text
// before persisting anything (see that service's own header comment). So an edit taken OFFLINE and
// replayed on reconnect re-checks compliance against the CFE THEN CURRENT (not the one that existed
// when the rep typed it), fail-closed: a CFE outage at replay time returns `held: true` and the
// service sets `approval_state: 'HELD'` — this module treats that as a SUCCESSFULLY PROCESSED
// mutation (the content was correctly re-vetted and correctly withheld), never as a "sent" outcome.
// No code path in this module can mark an edit synced without the server having actually re-run
// `evaluateContent` on the new text — there is exactly one call site (the real route), never a
// parallel/local approval.
//
// PERMANENT vs TRANSIENT replay failure (this is the piece the ritual's simpler pattern didn't need):
// approve/decline/edit can be rejected by the server for a reason retrying will NEVER fix (the draft
// no longer exists, or — master spec's own example — "an approval that expired while offline returns
// to the queue with an explanation": the item is no longer PENDING because something else already
// moved it). Retrying that forever on every future reconnect would wedge the sync queue in a stuck
// state that never resolves and never tells the rep anything useful. So a definitive 4xx business
// rejection (400/403/404/409 — deliberately NOT 5xx/network, which stay queued and retry) is treated
// as "finished processing" (removed from the queue, matching the master-spec text: the ACTION
// disappears from the sync queue and the ITEM returns to the Approval Inbox list, in its real
// server-side state, for the rep to see) — but is always surfaced through `onPermanentRejection`,
// never silently dropped.

import { MutationHandler, PersistentOfflineQueue } from '@/lib/offline/offline-queue';
import { isPermanentRejectionStatus, postJson, type PostJsonFn, type RawJsonResponse } from '@/lib/offline/http';

export { isPermanentRejectionStatus, postJson, type PostJsonFn, type RawJsonResponse };

export const INBOX_QUEUE_STORAGE_KEY = 'harvest:inbox:offline-queue:v1';

export const INBOX_MUTATION_KIND = {
  APPROVE: 'inbox/approve',
  DECLINE: 'inbox/decline',
  EDIT: 'inbox/edit',
} as const;

export type InboxMutationKind = (typeof INBOX_MUTATION_KIND)[keyof typeof INBOX_MUTATION_KIND];

export interface ApproveMutationPayload {
  draftId: string;
  // T-R16 (uiux AC-5.6-5) — carried through ONLY for a flagged-approve taken while offline; a
  // clean-PASS approve queued offline leaves this undefined, exactly as before this build unit.
  justification?: string;
}
export interface DeclineMutationPayload {
  draftId: string;
  reason: string;
  note?: string;
}
export interface EditMutationPayload {
  draftId: string;
  body: string;
}
export type InboxMutationPayload = ApproveMutationPayload | DeclineMutationPayload | EditMutationPayload;

/** Stable per-draft mutation ids for approve/decline — a repeat click before the offline queue-up
 *  has re-rendered the item out of its interactive footer enqueues only once (dedupe-by-id, same
 *  rationale as `RITUAL_MUTATION_ID` in the warm-market ritual's own offline module). Edit is
 *  deliberately NOT deduped by a fixed id — a rep may save an edit, keep editing, and save again
 *  while still offline; each is a genuinely distinct mutation and both must apply, in order, on
 *  replay (the second edit's fresh CFE re-check is against ITS OWN text, not the first edit's). */
export function approveMutationId(draftId: string): string {
  return `inbox:approve:${draftId}`;
}
export function declineMutationId(draftId: string): string {
  return `inbox:decline:${draftId}`;
}

interface ApiOkShape {
  ok?: boolean;
  error?: string;
}

export interface PermanentRejectionInfo {
  kind: InboxMutationKind;
  draftId: string;
  message: string;
}

/**
 * Builds the `replay()` handler map the Approval Inbox's offline queue dispatches to on reconnect.
 * Hits the EXACT same three routes (and therefore the exact same `ApprovalInboxService` methods —
 * approve/decline/editDraft) a live online action would — no parallel write path. `onPermanentRejection`
 * (optional) is called, synchronously, for every business-final rejection encountered during the
 * handlers this call returns; the caller (the page) reads it to surface a per-item, non-silent
 * explanation and to know it should reload the list from the server (§6.4 "failures surface
 * individually, never as a silent partial sync").
 */
export function createInboxQueueHandlers(
  postJsonFn: PostJsonFn,
  onPermanentRejection?: (info: PermanentRejectionInfo) => void
): Record<string, MutationHandler<unknown>> {
  return {
    [INBOX_MUTATION_KIND.APPROVE]: async (payload) => {
      const { draftId, justification } = payload as ApproveMutationPayload;
      const { status, data } = await postJsonFn<ApiOkShape>('/api/approval-inbox/approve', {
        draftId,
        justification,
      });
      if (status >= 200 && status < 300 && data.ok) return;
      if (isPermanentRejectionStatus(status)) {
        onPermanentRejection?.({
          kind: INBOX_MUTATION_KIND.APPROVE,
          draftId,
          message: data.error ?? 'This approval could not complete — it needs review again.',
        });
        return; // finished processing (never retryable) — resolved, not thrown.
      }
      throw new Error(`Approve replay failed (${status}): ${data.error ?? 'unknown error'}`);
    },
    [INBOX_MUTATION_KIND.DECLINE]: async (payload) => {
      const { draftId, reason, note } = payload as DeclineMutationPayload;
      const { status, data } = await postJsonFn<ApiOkShape>('/api/approval-inbox/decline', { draftId, reason, note });
      if (status >= 200 && status < 300 && data.ok) return;
      if (isPermanentRejectionStatus(status)) {
        onPermanentRejection?.({
          kind: INBOX_MUTATION_KIND.DECLINE,
          draftId,
          message: data.error ?? 'This decline could not complete.',
        });
        return;
      }
      throw new Error(`Decline replay failed (${status}): ${data.error ?? 'unknown error'}`);
    },
    // THE CFE RE-VALIDATION-ON-RECONNECT CALL — see this file's header. Never marks an edit synced
    // without the real route (and therefore the real `evaluateContent` re-entry) having run.
    [INBOX_MUTATION_KIND.EDIT]: async (payload) => {
      const { draftId, body } = payload as EditMutationPayload;
      const { status, data } = await postJsonFn<ApiOkShape>('/api/approval-inbox/edit', { draftId, body });
      // A 200 `ok:true` covers EVERY re-check outcome, including a fail-closed HELD — the CFE ran
      // for real against the new text either way, which is the only thing "synced" means here.
      if (status >= 200 && status < 300 && data.ok) return;
      if (isPermanentRejectionStatus(status)) {
        onPermanentRejection?.({
          kind: INBOX_MUTATION_KIND.EDIT,
          draftId,
          message: data.error ?? 'This edit could not be saved — it needs review again.',
        });
        return;
      }
      throw new Error(`Edit replay failed (${status}): ${data.error ?? 'unknown error'}`);
    },
  };
}

/** Re-derives which draft ids are STILL genuinely queued (not yet resolved, one way or the other)
 *  straight from the persisted queue's own contents — never a blanket assumption that a reload
 *  means "nothing is queued anymore". A reload after a PARTIAL flush (some mutations synced, one
 *  hit a TRANSIENT failure and stayed queued — see this file's header) must keep showing THAT
 *  item's `queuedOffline` banner; the server's own list response has no idea a local mutation for
 *  it is still pending, so the page re-applies this onto whatever the server just returned. */
export function deriveQueuedDraftIds(q: PersistentOfflineQueue): Set<string> {
  const ids = new Set<string>();
  for (const m of q.items) {
    if (m.kind === INBOX_MUTATION_KIND.APPROVE || m.kind === INBOX_MUTATION_KIND.DECLINE) {
      ids.add((m.payload as ApproveMutationPayload).draftId);
    } else if (m.kind === INBOX_MUTATION_KIND.EDIT) {
      ids.add((m.payload as EditMutationPayload).draftId);
    }
  }
  return ids;
}
