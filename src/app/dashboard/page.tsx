import { redirect } from 'next/navigation';

/**
 * T-R28 (parity audit T-51; uiux AC-2-1 "Today is the default landing surface; every login lands
 * on Today"). `/dashboard` used to render the pre-rebuild demo scaffold below — hardcoded mock
 * arrays (`actions`, `laws`), `#fragment` in-page anchors instead of real navigation, and no links
 * to any of the five real WP-built destinations (`/today`, `/community`, `/grow`, `/learn`, `/me`).
 * A successful login pushed straight here (src/app/auth/page.tsx), so every session landed on the
 * demo instead of Mission Control.
 *
 * `/dashboard` is deliberately kept as a real, gated route (it stays in `src/middleware.ts`'s
 * `matcher` and is still what `scripts/verify-middleware.mjs` checks for) rather than deleted —
 * that guard exists specifically to catch `middleware.ts` silently failing to register, and its
 * check is "a matcher covers /dashboard". Removing the route would defeat that regression guard.
 * Instead, `/dashboard` is now a pure server-side redirect stub: authentication is enforced first
 * by the middleware (unchanged), and once past that gate, this component immediately redirects to
 * `/today` so no user path — old bookmarks, the marketing homepage's "View dashboard" link, the
 * onboarding handoff — can dead-end on the retired demo.
 */
export default function DashboardPage() {
  redirect('/today');
}
