import { redirect } from 'next/navigation';

/**
 * T-57 R3c-1 (MINOR-m2, uiux §2.4 route map: "`/today/briefing` — expanded overnight briefing with
 * receipts"). The Briefing Card (with its own receipt chevrons, §4.1) already renders in-page on
 * plain `/today` (`today/page.tsx` → `BriefingCard`) — there is no separate expanded surface to
 * alias to. A real, honest alias to where the feature actually lives; never a 404 dead end (§2.4).
 */
export default function TodayBriefingAliasPage() {
  redirect('/today');
}
