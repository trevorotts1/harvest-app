// T-R13 (uiux §5.3 "approve-with-inline-edit ... embedded full-width", embedding §4.2/§4.3) —
// embeds T-33's real Approval Inbox Item component directly in the Shift's Work-phase card, in
// place of the old deep-link-to-`/inbox` stopgap (see WorkPhase.tsx's prior header note and
// ShiftApprovalRequiresReviewError's doc comment in shift.service.ts). This file REUSES, and never
// reimplements, the two things that matter:
//   - Approve/Decline flow through the SAME `onAction` -> POST /api/shift/action ->
//     `ShiftService.actionCard` path every other Work-phase action already uses — T-34's offline
//     queue + optimistic-advance keep working unchanged, and `actionCard`'s own fail-closed check
//     (a non-PASS draft's APPROVE throws `ShiftApprovalRequiresReviewError`) is untouched and still
//     the real authority (see that class's doc comment for the T-R13 note).
//   - Edit posts straight to the real `POST /api/approval-inbox/edit` route — i.e.
//     `ApprovalInboxService.editDraft` — so an edit taken here RE-ENTERS THE CFE exactly as it
//     would on the real Approval Inbox page. No CFE logic lives in this file.
//
// `ApprovalInboxItem` itself is imported unmodified — its own fail-closed render rule (no Approve
// button while `approval_state === 'HELD'`) is consumed as-is, never touched.

'use client';

import ApprovalInboxItem, { type InboxItemData } from '@/app/inbox/components/ApprovalInboxItem';
import type { ShiftCardAction, ShiftQueueCard } from '@/types/learning-state';

export interface DraftApprovalCardProps {
  card: ShiftQueueCard;
  onAction: (cardId: string, action: ShiftCardAction) => Promise<void> | undefined;
}

/** Builds the `InboxItemData` `ApprovalInboxItem` needs straight from the `ShiftQueueCard.draft`
 * payload `ShiftService.buildCandidateStack` already hydrates from the real DraftMessage row — no
 * second source of truth for any of these fields. */
export function cardToInboxItem(card: ShiftQueueCard): InboxItemData {
  const d = card.draft;
  return {
    id: card.id,
    contact_id: d?.contactId ?? '',
    contact: d?.contact ?? null,
    channel: d?.channel ?? '',
    body: card.detail,
    cfe_outcome: (card.cfeOutcome as InboxItemData['cfe_outcome']) ?? null,
    cfe_risk_score: d?.cfeRiskScore ?? null,
    approval_state: (d?.approvalState as InboxItemData['approval_state']) ?? 'PENDING',
    created_at: d?.createdAt ?? new Date(0).toISOString(),
  };
}

/** Approve — wired through the EXACT same `onAction` the rest of WorkPhase already uses (preserves
 * T-34's offline queue/optimistic-advance). `ShiftService.actionCard`'s fail-closed check is the
 * real authority and is NOT re-implemented or loosened here: a rejection (e.g.
 * `ShiftApprovalRequiresReviewError`, surfaced by the route as a 409) is translated into the
 * `{ok:false, error}` shape `ApprovalInboxItem` renders inline — never swallowed, never retried
 * into a silent success. */
export function makeApproveHandler(
  onAction: DraftApprovalCardProps['onAction']
): (draftId: string) => Promise<{ ok: boolean; error?: string }> {
  return async (draftId: string) => {
    try {
      await onAction(draftId, 'APPROVE');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'This draft could not be approved.' };
    }
  };
}

/** Decline — same `onAction` path, same offline queue; never gated (rejecting risky content is
 * always safe, unchanged since before T-R13). The embedded item's own reason selector (uiux
 * AC-5.6-9) still always intercepts the decline interaction — Shift's one-tap decline action itself
 * carries no reason/note field, same as it did before this build unit. */
export function makeDeclineHandler(
  onAction: DraftApprovalCardProps['onAction']
): (draftId: string, reason: string, note?: string) => Promise<{ ok: boolean; error?: string }> {
  return async (draftId: string) => {
    try {
      await onAction(draftId, 'DECLINE');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'This draft could not be declined.' };
    }
  };
}

/** THE RE-ENTRY CALL, taken from inside the Shift: posts to the real `/api/approval-inbox/edit`
 * route backing `ApprovalInboxService.editDraft` (T-33) — the CFE is re-evaluated there, exactly as
 * it would be on the real Approval Inbox page; this function calls no CFE logic itself. The
 * re-checked band/body/approval_state ALWAYS replace the pre-edit ones in the merged result (mirrors
 * `inbox/page.tsx`'s own `handleEdit` merge) — contact/channel/created_at are carried over from
 * `initialItem` since the edit route's response doesn't repeat them. */
export function makeEditHandler(
  initialItem: InboxItemData,
  fetchImpl: typeof fetch = fetch
): (draftId: string, body: string) => Promise<{ ok: boolean; item?: InboxItemData; error?: string }> {
  return async (draftId: string, body: string) => {
    let res: Response;
    try {
      res = await fetchImpl('/api/approval-inbox/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftId, body }),
      });
    } catch {
      return { ok: false, error: 'This edit could not be saved.' };
    }

    let data: { ok?: boolean; error?: string; draft?: InboxItemData };
    try {
      data = await res.json();
    } catch {
      return { ok: false, error: 'This edit could not be saved.' };
    }

    if (!res.ok || !data.ok || !data.draft) {
      return { ok: false, error: data.error ?? 'This edit could not be saved.' };
    }

    // The re-checked band ALWAYS replaces the stale one — never a pre-edit field survives the merge.
    const merged: InboxItemData = {
      ...initialItem,
      body: data.draft.body,
      cfe_outcome: data.draft.cfe_outcome,
      cfe_risk_score: data.draft.cfe_risk_score,
      approval_state: data.draft.approval_state,
    };
    return { ok: true, item: merged };
  };
}

export default function DraftApprovalCard({ card, onAction }: DraftApprovalCardProps) {
  const item = cardToInboxItem(card);
  return (
    <ApprovalInboxItem
      item={item}
      onApprove={makeApproveHandler(onAction)}
      onDecline={makeDeclineHandler(onAction)}
      onEdit={makeEditHandler(item)}
    />
  );
}
