// WP01 §6.10-1 / uiux AC-5.1-11 — the RESUME target of the onboarding gate. `src/middleware.ts`
// redirects any authenticated-but-not-GATED_COMPLETE user here (and the API-layer `withOnboardingGate`
// mirrors this path in its 403 `redirectTo`), carrying the last-incomplete step as `?step=`. This
// server component resolves that step to the exact O-screen via the pure `resumeScreen` map, so a
// returning rep lands precisely where they left off — never a blank or first-step reset.
//
// R-01 (refinements catalog 2026-07-28) — the role (persisted since R-07) is handed to the flow
// exactly as on the fresh-entry page (src/app/onboarding/page.tsx), so a returning RVP resumes
// with the same no-pairing behavior they started with. Read from the SERVER session, never client
// input.

import { Role } from '@prisma/client';

import { getCurrentSession } from '@/lib/auth/session';

import { resumeScreen } from '../flow-model';
import OnboardingFlow from '../OnboardingFlow';

// The step comes from the live redirect (per-request); never statically prerender this.
export const dynamic = 'force-dynamic';

export default async function OnboardingResumePage({
  searchParams,
}: {
  searchParams?: { step?: string | string[] };
}) {
  const session = await getCurrentSession();
  const role = (session?.user?.role as Role | undefined) ?? Role.REP;
  const rawStep = searchParams?.step;
  const step = Array.isArray(rawStep) ? rawStep[0] : rawStep;
  return <OnboardingFlow role={role} initialScreen={resumeScreen(step)} />;
}
