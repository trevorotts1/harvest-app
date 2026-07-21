// T-57 R3b (E-M4, master-spec §4.5/§4.6/§6.10-1, uiux §4.9) — Me → Intensity's persistence route.
//
// `User.intensity_setting` (prisma/schema.prisma) is written exactly once today, during onboarding
// (`/api/onboarding/step` / `/api/onboarding/complete` — src/services/onboarding/wp01), and nothing
// in the app can change it afterward — a real gap the uiux spec calls out by name: "[the intensity
// dial] lives in onboarding and Me; changeable any time" (§4.9), and MINOR-D5 (T-57 findings) notes
// the missing "intensity-change affordance" for the budget-exhausted hold message. This route is
// that missing post-onboarding write path, scoped to exactly one field.
//
// Mirrors `/api/settings/locale/route.ts`'s own precedent verbatim: a low-stakes, per-rep
// preference, not an authorization signal, so a plain per-request Prisma read/write keyed off the
// authenticated session's user id is proportionate — no step-up MFA (intensity change is not one of
// §16.4's five sensitive actions), any authenticated role may read/set their own. Gated by
// `withOnboardingGate` (not the bare `withRole` the locale route uses) because intensity directly
// calibrates the agent dispatch/cost governor (§4.2/§4.5) — a rep who has not yet reached
// `gated_complete` has no agents running yet for this to apply to, and every other Me surface is
// already reached only past that gate (src/middleware.ts's `/me/:path*` matcher).
import { IntensitySetting } from '@prisma/client';
import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function isIntensitySetting(value: unknown): value is IntensitySetting {
  return value === IntensitySetting.LOW || value === IntensitySetting.MEDIUM || value === IntensitySetting.HIGH;
}

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const user = await prisma.user.findUnique({
    where: { id: identity.userId },
    select: { intensity_setting: true },
  });
  return NextResponse.json({ intensity_setting: user?.intensity_setting ?? IntensitySetting.MEDIUM });
});

export const PATCH = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const body = await req.json().catch(() => null);
  const intensitySetting = (body as { intensity_setting?: unknown } | null)?.intensity_setting;
  if (!isIntensitySetting(intensitySetting)) {
    return NextResponse.json({ error: '"intensity_setting" must be "LOW", "MEDIUM", or "HIGH".' }, { status: 400 });
  }

  await prisma.user.update({ where: { id: identity.userId }, data: { intensity_setting: intensitySetting } });
  return NextResponse.json({ ok: true, intensity_setting: intensitySetting });
});
