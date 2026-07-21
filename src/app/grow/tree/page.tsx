import { redirect } from 'next/navigation';

/**
 * T-57 R3c-1 (MINOR-m2, uiux §2.4 route map: "`/grow` · `/grow/tree` · `/grow/timeline` ·
 * `/grow/goal-card` — Grow home, Orchard/rings, phased timeline, Goal Commitment Card"). Before
 * this fix, `/grow/tree` 404'd — the spec names it as a real destination, but the Orchard/rings
 * canvas it names has always lived at plain `/grow` (the default `view === 'canvas'` state,
 * `src/app/grow/page.tsx`), never at its own route. Rather than fork that view into a second real
 * page (a second live/list-view/zoom state to keep in sync — out of this build unit's ownership,
 * which owns only the top of `grow/page.tsx`, not its internal view-toggle state), this is the
 * honest, deep-link-law-compliant fix (§2.4 "never a 404 dead end"): a real alias to the one place
 * that feature actually lives.
 */
export default function GrowTreeAliasPage() {
  redirect('/grow');
}
