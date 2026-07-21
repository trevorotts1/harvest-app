import { redirect } from 'next/navigation';

/**
 * T-57 R3c-1 (MINOR-m2, uiux §2.4 route map). `/grow/timeline` names the phased-timeline feature
 * (`PhasedTimelinePanel`), which already renders in-page on plain `/grow` (Primerica branch only,
 * §17.1 — the universal branch renders nothing there, by design). No standalone timeline page
 * exists to alias to something OTHER than `/grow` itself, so this is a real, honest alias to the
 * one place the feature lives — never a 404 dead end (§2.4).
 */
export default function GrowTimelineAliasPage() {
  redirect('/grow');
}
