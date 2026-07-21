// T-57 R3c-1 (MAJOR-M6, uiux §2.4 route map: "`/inbox` · `/inbox/{item_id}` — Approval Inbox;
// single-item review (notification deep link)" / §5.6 "notification deep links to
// `/inbox/{item_id}` (with the approve-from-notification action on native, §6.5)"). Before this
// fix, `/inbox/{item_id}` 404'd — every notification/deep-link target the uiux spec names for a
// single approval item had nowhere to land.
//
// OWNERSHIP BOUNDARY (explicit): `ApprovalInboxItem` (`../components/ApprovalInboxItem.tsx`) and
// the full list page (`../page.tsx`) are owned by a different unit and are NOT modified here — this
// file only IMPORTS and USES the existing item component, exactly as instructed. It fetches the
// same real `GET /api/approval-inbox` list route the main inbox page uses (no per-id GET route
// exists — see that route's own header — so this reads the caller's full list, scoped server-side
// to their OWN drafts via `withOnboardingGate`, same as the list page, and finds the one item
// client-side) and wires the SAME three real mutation routes
// (`/api/approval-inbox/{approve,decline,edit}`) `../page.tsx`'s own `handleApprove`/
// `handleDecline`/`handleEdit` call, including the AC-5.6-6 own-number chain into
// `ComposerHandoffSheet` on an SMS_HANDOFF approve.
//
// SCOPE NOTE (stated, not silent): this single-item deep-link surface deliberately does NOT
// replicate the list page's full offline mutation queue (`PersistentOfflineQueue` + FIFO replay) —
// that is real, substantial, list-page-scoped infrastructure this build unit does not own the
// files for, and a single notification-opened item is a narrower surface than the whole queue.
// `ApprovalInboxItem`'s own `queuedOffline` prop is deliberately NEVER set here: that flag's real
// contract is "an action WAS taken and is genuinely queued for replay" (its own banner literally
// says so, `inbox.item.queuedBanner`) — this page never queues anything, so setting it would
// fabricate a queued action that doesn't exist (a doctrine violation, §18.6). Instead, every
// handler below is wrapped in try/catch: `ApprovalInboxItem` itself calls `await onApprove(...)`
// with NO try/catch of its own (confirmed by reading it — a rejected promise from a network error
// while offline would otherwise be an unhandled rejection), so a fetch failure here always resolves
// to an honest `{ ok: false, error }`, surfaced through the SAME error banner the component already
// renders for any other failure — no separate offline-only rendering branch needed.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { isOnline, subscribeOnlineStatus } from '@/lib/offline/online-status';
import { useT } from '@/app/locale-context';
import ComposerHandoffSheet from '@/app/community/components/ComposerHandoffSheet';
import ApprovalInboxItem, { type InboxItemData } from '../components/ApprovalInboxItem';
import inboxStyles from '../inbox.module.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error' }
  | { kind: 'ready'; item: InboxItemData };

export default function InboxSingleItemPage() {
  const t = useT();
  const params = useParams<{ itemId: string }>();
  const itemId = params?.itemId;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [isOffline, setIsOffline] = useState(() => !isOnline());
  const [composerFor, setComposerFor] = useState<{ draftId: string; contactName: string } | null>(null);

  const load = useCallback(async () => {
    if (!itemId) return;
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/approval-inbox?state=ALL');
      if (!res.ok) {
        setState({ kind: 'error' });
        return;
      }
      const body = await res.json();
      const items = (body.items ?? []) as InboxItemData[];
      const found = items.find((i) => i.id === itemId);
      setState(found ? { kind: 'ready', item: found } : { kind: 'not_found' });
    } catch {
      setState({ kind: 'error' });
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribeOnlineStatus((online) => {
      setIsOffline(!online);
      if (online) void load();
    });
    return unsubscribe;
  }, [load]);

  // NOTE (matches ../page.tsx's own handleEdit exactly, for the same reason): the approve/decline/
  // edit routes all return `draft: result.draft`, which is the RAW `DraftMessage` Prisma row (no
  // `contact` relation, not the presentation shape the list GET route decrypts/joins) — never
  // spread wholesale over the existing `InboxItemData`. Only the specific fields each route
  // actually changes are merged onto the EXISTING full item, so `contact`/`channel`/etc. survive.

  const handleApprove = useCallback(
    async (draftId: string, justification?: string): Promise<{ ok: boolean; error?: string }> => {
      const existing = state.kind === 'ready' ? state.item : null;
      if (!existing) return { ok: false, error: t('inbox.errors.draftNotInView') };
      try {
        const res = await fetch('/api/approval-inbox/approve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ draftId, justification }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return { ok: false, error: data.error ?? t('inbox.errors.approveFailed') };
        setState({ kind: 'ready', item: { ...existing, approval_state: 'APPROVED' } });
        // AC-5.6-6 — own-number first touch chains into the Composer Handoff Sheet on approval,
        // same as ../page.tsx's own handleApprove.
        if (existing.channel === 'SMS_HANDOFF') {
          const name = existing.contact ? `${existing.contact.firstName} ${existing.contact.lastName}` : t('inbox.item.contactFallback');
          setComposerFor({ draftId, contactName: name });
        }
        return { ok: true };
      } catch {
        return { ok: false, error: t('inbox.errors.approveFailed') };
      }
    },
    [state, t]
  );

  const handleDecline = useCallback(
    async (draftId: string, reason: string, note?: string): Promise<{ ok: boolean; error?: string }> => {
      const existing = state.kind === 'ready' ? state.item : null;
      if (!existing) return { ok: false, error: t('inbox.errors.draftNotInView') };
      try {
        const res = await fetch('/api/approval-inbox/decline', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ draftId, reason, note }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return { ok: false, error: data.error ?? t('inbox.errors.declineFailed') };
        setState({ kind: 'ready', item: { ...existing, approval_state: 'DECLINED' } });
        return { ok: true };
      } catch {
        return { ok: false, error: t('inbox.errors.declineFailed') };
      }
    },
    [state, t]
  );

  const handleEdit = useCallback(
    async (draftId: string, body: string): Promise<{ ok: boolean; item?: InboxItemData; error?: string }> => {
      const existing = state.kind === 'ready' ? state.item : null;
      if (!existing) return { ok: false, error: t('inbox.errors.draftNotInView') };
      try {
        const res = await fetch('/api/approval-inbox/edit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ draftId, body }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return { ok: false, error: data.error ?? t('inbox.errors.editFailed') };
        // The re-checked band ALWAYS replaces the stale one — never a pre-edit field survives.
        const merged: InboxItemData = {
          ...existing,
          body: data.draft.body,
          cfe_outcome: data.draft.cfe_outcome,
          cfe_risk_score: data.draft.cfe_risk_score,
          approval_state: data.draft.approval_state,
        };
        setState({ kind: 'ready', item: merged });
        return { ok: true, item: merged };
      } catch {
        return { ok: false, error: t('inbox.errors.editFailed') };
      }
    },
    [state, t]
  );

  return (
    <main className={inboxStyles.page}>
      <div className={inboxStyles.shell}>
        <div className={inboxStyles.headerRow}>
          <h1 className={inboxStyles.title}>{t('inbox.title')}</h1>
          <Link href="/inbox" className={inboxStyles.growLink}>
            {t('common.back')}
          </Link>
        </div>

        {isOffline && (
          <p role="status" className={inboxStyles.offlineBanner}>
            {t('inbox.offlineBanner')}
          </p>
        )}

        {state.kind === 'loading' && <p>{t('common.loading')}</p>}

        {state.kind === 'error' && (
          <>
            <p role="alert">{t('inbox.loadError')}</p>
            <button type="button" onClick={load}>
              {t('common.retry')}
            </button>
          </>
        )}

        {state.kind === 'not_found' && (
          <div role="status" aria-live="polite">
            <p>{t('notFound.heading')}</p>
            <p>{t('notFound.body')}</p>
            <Link href="/today">{t('notFound.cta')}</Link>
          </div>
        )}

        {state.kind === 'ready' && (
          <ApprovalInboxItem item={state.item} onApprove={handleApprove} onDecline={handleDecline} onEdit={handleEdit} />
        )}
      </div>

      <ComposerHandoffSheet
        open={composerFor !== null}
        draftId={composerFor?.draftId ?? null}
        contactName={composerFor?.contactName ?? ''}
        onClose={() => setComposerFor(null)}
      />
    </main>
  );
}
