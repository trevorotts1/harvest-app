// T-55 (master-spec §17.7; uiux §5.6 "Nothing waiting" / "Flagged-empty" named states) — a zero-item
// result previously showed the same "a good day" copy for every filter, including "Held" and
// "Declined" where that framing doesn't fit. A pure function (this codebase's established
// testability seam for branching copy logic — see ShiftView.tsx's `formatElapsed`) so the exact
// string per filter is unit-tested without needing to render the fetch-driven page.
//
// Lives outside page.tsx: Next.js's App Router only permits a page module to export the framework's
// own recognized names (default, metadata, generateStaticParams, ...) — `tsc`'s generated route
// types reject any other named export from a page.tsx file.
//
// T-R32 (master-spec §17.5; uiux §6.2) — this per-filter copy was a NAMED deep-copy i18n gap (a raw
// literal in a plain `.ts` module, never scanned by `guard-no-literals-in-components.mjs`, which only
// walks `.tsx`, so this gap was invisible to that guard even though it's real un-i18n'd rep-facing
// copy). Now routed through the catalog: the caller passes the rep's locale, this looks up the
// per-filter key via `t()` — same fallback-safe, never-blank contract as every other catalog lookup.

import { t } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

export type InboxFilterKey = 'AWAITING' | 'HELD' | 'APPROVED' | 'DECLINED' | 'ALL';

const EMPTY_STATE_KEY: Record<InboxFilterKey, string> = {
  AWAITING: 'inbox.emptyState.awaiting',
  HELD: 'inbox.emptyState.held',
  APPROVED: 'inbox.emptyState.approved',
  DECLINED: 'inbox.emptyState.declined',
  ALL: 'inbox.emptyState.all',
};

export function inboxEmptyStateMessage(filter: InboxFilterKey, locale: Locale): string {
  return t(locale, EMPTY_STATE_KEY[filter]);
}
