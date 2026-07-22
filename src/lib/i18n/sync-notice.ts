// T-57 RE-GATE ROUND-4 hardening, DIMENSION B — the localized offline-sync NOTICE builders. Before
// this, all three offline surfaces (Approval Inbox `inbox/page.tsx`, Today `today/page.tsx`, and the
// Warm-Market Ritual `WarmMarketRitual.tsx`) hand-built their post-reconnect sync notice from a
// copy-pasted English template that ALSO spliced the raw internal mutation-kind token straight into
// the text — e.g. `1 item couldn't sync yet (inbox/approve) — …`. A Spanish rep saw English AND a
// raw `inbox/approve` route-path token. These builders move that copy into the catalog
// (`offline.sync.*`) and humanize the mutation kind through `syncActionLabel`, so every surface
// renders the SAME localized, token-free notice.
//
// The mutation-kind tokens (`inbox/approve`, `today/queue-action`, `warm-market/blank-canvas`, …)
// are UI-internal offline-queue vocabulary (defined in each surface's own `offline.ts`), not backend
// error codes — hence a small dedicated mapper here rather than reusing `errorDisplay`/`errorStateLabel`.
// An unknown/future kind falls back to a generic "an update", never the raw token.

import { type Translate } from './error-display';

/** Maps a `PersistentOfflineQueue` mutation-kind token to a localized human ACTION noun for
 *  interpolation into a sync notice. Unknown → `offline.sync.action.generic` ("an update"). */
export function syncActionLabel(t: Translate, kind: string | null | undefined): string {
  switch (kind) {
    case 'inbox/approve':
      return t('offline.sync.action.approve');
    case 'inbox/decline':
      return t('offline.sync.action.decline');
    case 'inbox/edit':
      return t('offline.sync.action.edit');
    case 'today/queue-action':
      return t('offline.sync.action.queueAction');
    case 'today/attendance':
      return t('offline.sync.action.attendance');
    case 'warm-market/blank-canvas':
    case 'warm-market/qualities-flip':
      return t('offline.sync.action.ritualStep');
    default:
      return t('offline.sync.action.generic');
  }
}

/** The notice shown when MORE THAN ONE queued mutation was permanently rejected on reconnect (they
 *  moved on server-side and need review again). Only reached with `count >= 2` (the single-rejection
 *  case surfaces that rejection's own resolved message), so the ES noun stays plural. */
export function multipleRejectedNotice(t: Translate, count: number): string {
  return t('offline.sync.multipleRejected', { count });
}

/** The notice shown when a genuinely TRANSIENT (network/5xx) failure left one item still queued for
 *  the next attempt — with any already-synced count as an honest lead-in. `failedKind` is humanized
 *  via `syncActionLabel`; the failed count is always exactly 1 (replay stops on the first failure),
 *  so no plural is needed for it. */
export function transientSyncNotice(t: Translate, synced: number, failedKind: string | null | undefined): string {
  const prefix = synced > 0 ? t('offline.sync.syncedPrefix', { count: synced }) : '';
  return prefix + t('offline.sync.transientOne', { action: syncActionLabel(t, failedKind) });
}
