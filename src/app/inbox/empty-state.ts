// T-55 (master-spec §17.7; uiux §5.6 "Nothing waiting" / "Flagged-empty" named states) — a zero-item
// result previously showed the same "a good day" copy for every filter, including "Held" and
// "Declined" where that framing doesn't fit. A pure function (this codebase's established
// testability seam for branching copy logic — see ShiftView.tsx's `formatElapsed`) so the exact
// string per filter is unit-tested without needing to render the fetch-driven page.
//
// Lives outside page.tsx: Next.js's App Router only permits a page module to export the framework's
// own recognized names (default, metadata, generateStaticParams, ...) — `tsc`'s generated route
// types reject any other named export from a page.tsx file.

export type InboxFilterKey = 'AWAITING' | 'HELD' | 'APPROVED' | 'DECLINED' | 'ALL';

export function inboxEmptyStateMessage(filter: InboxFilterKey): string {
  if (filter === 'HELD') return "Nothing held for review — your field's been clean.";
  if (filter === 'DECLINED') return 'Nothing declined yet.';
  if (filter === 'APPROVED') return 'Nothing approved yet — your first approval will show up here.';
  return 'Nothing waiting on you right now — a good day.';
}
