// WP01 §6.10-1 / uiux AC-5.1-11 — the RESUME target of the onboarding gate. `src/middleware.ts`
// redirects any authenticated-but-not-GATED_COMPLETE user here (and the API-layer `withOnboardingGate`
// mirrors this path in its 403 `redirectTo`), carrying the last-incomplete step as `?step=`. This
// server component resolves that step to the exact O-screen via the pure `resumeScreen` map, so a
// returning rep lands precisely where they left off — never a blank or first-step reset.

import { resumeScreen } from '../flow-model';
import OnboardingFlow from '../OnboardingFlow';

// The step comes from the live redirect (per-request); never statically prerender this.
export const dynamic = 'force-dynamic';

export default function OnboardingResumePage({
  searchParams,
}: {
  searchParams?: { step?: string | string[] };
}) {
  const rawStep = searchParams?.step;
  const step = Array.isArray(rawStep) ? rawStep[0] : rawStep;
  return <OnboardingFlow initialScreen={resumeScreen(step)} />;
}
