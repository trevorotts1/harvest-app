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
import { useT } from '@/app/locale-context';
import { errorDisplay, errorStateLabel, type Translate } from '@/lib/i18n/error-display';
import type { ShiftCardAction, ShiftQueueCard } from '@/types/learning-state';

export interface DraftApprovalCardProps {
  card: ShiftQueueCard;
  onAction: (cardId: string, action: ShiftCardAction) => Promise<void> | undefined;
}

/** T-57 RE-GATE ROUND-3 (B [a7133fce] residual) — duck-types the `code`/`currentState` a rejected
 *  `onAction` MAY carry (see `ShiftView.tsx`'s `CodedActionError` / `postJson`) without importing
 *  that orchestrator type here: `onAction` is a generic prop, and a caller-supplied stub (as every
 *  test in this file uses) may reject with anything — a plain `Error`, a non-Error value, or a
 *  real `CodedActionError`. Reading defensively, rather than an `instanceof` check tied to one
 *  concrete class, is what keeps `errorDisplay`'s own fail-safe intact: an absent/unrecognized
 *  `code` (including every non-Error rejection) resolves to `errors.generic`, never a crash and
 *  never a raw English `.message`. */
function codedFromCaught(error: unknown): { code?: string; currentState?: string } {
  if (!error || typeof error !== 'object') return {};
  const e = error as { code?: unknown; currentState?: unknown };
  return {
    code: typeof e.code === 'string' ? e.code : undefined,
    currentState: typeof e.currentState === 'string' ? e.currentState : undefined,
  };
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
 * into a silent success.
 *
 * T-R16 (uiux AC-5.6-5): accepts the optional `justification` second argument `ApprovalInboxItem`'s
 * shared flagged-approve control now passes, purely for type compatibility with that component's
 * `onApprove` prop — it is intentionally NOT forwarded anywhere. `ShiftService.actionCard` has no
 * concept of a justification and, per that class's own doc comment, unconditionally refuses any
 * non-PASS APPROVE regardless of what the caller sends; the intended path for a flagged draft
 * remains "edit it into a clean re-checked PASS first" or "review it in the real Approval Inbox"
 * (the 409 message already says so). This host loses nothing by ignoring the argument.
 *
 * T-57 RE-GATE ROUND-3 (B [a7133fce]) — the previous version rendered `error.message` (or a
 * hardcoded English fallback) verbatim: since `/api/shift/action`'s `ShiftOwnershipError`/
 * `ShiftApprovalRequiresReviewError` refusals are ALWAYS raw English prose, a Spanish rep saw
 * untranslated English on this exact card every time either fail-closed check fired. Fixed
 * exactly like `makeEditHandler` below: never read `.message` for display — resolve the DISPLAY
 * string from the machine `code` `ShiftView.tsx`'s `postJson` now attaches to the rejection (see
 * `codedFromCaught` above) via `errorDisplay`. An absent/unrecognized `code` (including every
 * non-Error rejection) safely resolves to `errors.generic` — never English, never blank. */
export function makeApproveHandler(
  onAction: DraftApprovalCardProps['onAction'],
  t: Translate
): (draftId: string, justification?: string) => Promise<{ ok: boolean; error?: string }> {
  return async (draftId: string) => {
    try {
      await onAction(draftId, 'APPROVE');
      return { ok: true };
    } catch (error) {
      const { code, currentState } = codedFromCaught(error);
      return { ok: false, error: errorDisplay(t, code, { currentState: errorStateLabel(t, currentState) }) };
    }
  };
}

/** Decline — same `onAction` path, same offline queue; never gated (rejecting risky content is
 * always safe, unchanged since before T-R13). The embedded item's own reason selector (uiux
 * AC-5.6-9) still always intercepts the decline interaction — Shift's one-tap decline action itself
 * carries no reason/note field, same as it did before this build unit.
 *
 * T-57 RE-GATE ROUND-3 (B [a7133fce]) — same fix as `makeApproveHandler` above: e.g. a
 * `ShiftOwnershipError` (a decline on a card that isn't the rep's own) resolves via `errorDisplay`,
 * never the raw English `.message`. */
export function makeDeclineHandler(
  onAction: DraftApprovalCardProps['onAction'],
  t: Translate
): (draftId: string, reason: string, note?: string) => Promise<{ ok: boolean; error?: string }> {
  return async (draftId: string) => {
    try {
      await onAction(draftId, 'DECLINE');
      return { ok: true };
    } catch (error) {
      const { code, currentState } = codedFromCaught(error);
      return { ok: false, error: errorDisplay(t, code, { currentState: errorStateLabel(t, currentState) }) };
    }
  };
}

/** THE RE-ENTRY CALL, taken from inside the Shift: posts to the real `/api/approval-inbox/edit`
 * route backing `ApprovalInboxService.editDraft` (T-33) — the CFE is re-evaluated there, exactly as
 * it would be on the real Approval Inbox page; this function calls no CFE logic itself. The
 * re-checked band/body/approval_state ALWAYS replace the pre-edit ones in the merged result (mirrors
 * `inbox/page.tsx`'s own `handleEdit` merge) — contact/channel/created_at are carried over from
 * `initialItem` since the edit route's response doesn't repeat them.
 *
 * T-57 RE-GATE B [af7789d3] Finding 1 residual (RGb2) — the route ALWAYS populates `error` with raw
 * English prose; the DISPLAY string surfaced to `ApprovalInboxItem` is resolved from the route's
 * machine `code` via `errorDisplay`, mirroring `inbox/page.tsx`'s own `handleEdit` fix exactly. The
 * raw `error` stays on the wire for logs/back-compat only — never rendered. */
export function makeEditHandler(
  initialItem: InboxItemData,
  t: Translate,
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
      // T-57 RG4 (B leak) — was hardcoded English rendered by ApprovalInboxItem; a transport/parse
      // failure carries no server `code`, so resolve the localized "couldn't save this edit" copy
      // from the catalog via `errorDisplay` (mirrors the approve/decline handlers above).
      return { ok: false, error: errorDisplay(t, 'EDIT_SAVE_FAILED') };
    }

    let data: { ok?: boolean; error?: string; code?: string; currentState?: string; draft?: InboxItemData };
    try {
      data = await res.json();
    } catch {
      // T-57 RG4 (B leak) — was hardcoded English rendered by ApprovalInboxItem; a transport/parse
      // failure carries no server `code`, so resolve the localized "couldn't save this edit" copy
      // from the catalog via `errorDisplay` (mirrors the approve/decline handlers above).
      return { ok: false, error: errorDisplay(t, 'EDIT_SAVE_FAILED') };
    }

    if (!res.ok || !data.ok || !data.draft) {
      return {
        ok: false,
        error: errorDisplay(t, data.code, { currentState: errorStateLabel(t, data.currentState) }),
      };
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
  const t = useT();
  const item = cardToInboxItem(card);
  return (
    <ApprovalInboxItem
      item={item}
      onApprove={makeApproveHandler(onAction, t)}
      onDecline={makeDeclineHandler(onAction, t)}
      onEdit={makeEditHandler(item, t)}
    />
  );
}
