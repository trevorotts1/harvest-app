// T-43 (WP07 §12.3) — POST /api/gamification/milestones/share: builds the anchor-tied share-to-
// social text for a milestone, CFE-CLEARED before it is ever returned to the client (§12.9-3 "shares
// are CFE-filtered"). A held/flagged/blocked verdict returns 200 with `status: 'held'` and NO text —
// never a partially-cleared string.
//
// T-57 RG6 (i18n; master-spec §17.5) — `buildMilestoneShareText` grew an optional trailing `locale`
// param in T-57 RG5-FINAL (`celebration.service.ts`), but THIS route — its one real caller — still
// omitted it, so the share text this route returns resolved to English for every rep regardless of
// their own locale (flagged by that unit's own header note as the tracked, un-owned fast-follow).
// Fixed here by resolving the rep's `User.locale` with the identical duck-typed
// `prisma.user.findUnique({ select: { locale: true } })` pattern `today.service.ts`'s
// `resolveRepLocale` / `zones/briefing.ts`'s own copy already use (trivial here since this route
// already imports `prisma` directly) and passing it through as the explicit 5th argument. Fails soft
// to `DEFAULT_LOCALE` (English, byte-identical to the pre-fix behavior) on a missing/invalid
// `User.locale` or a lookup error — a locale-resolution hiccup must never block a share.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildMilestoneShareText, ALL_MILESTONE_KEYS, MilestoneKey } from '@/services/gamification/celebration.service';
import { readAnchorStatement } from '@/services/gamification/anchor';
import { prisma } from '@/lib/prisma';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locale';

export const dynamic = 'force-dynamic';

/** Same fail-soft, duck-typed shape as `today.service.ts`'s `resolveRepLocale` — never throws; a
 *  locale-lookup hiccup degrades to English, it must never block a milestone share. */
async function resolveRepLocale(userId: string): Promise<Locale> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
    return isLocale(user?.locale) ? user.locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.key || !ALL_MILESTONE_KEYS.includes(body.key as MilestoneKey)) {
    return NextResponse.json({ error: '"key" must be a valid milestone key.' }, { status: 400 });
  }

  const [anchor, locale] = await Promise.all([
    readAnchorStatement(prisma as never, identity.userId),
    resolveRepLocale(identity.userId),
  ]);
  const result = await buildMilestoneShareText(
    body.key as MilestoneKey,
    anchor,
    { user_id: identity.userId, role: identity.role },
    undefined,
    locale
  );
  return NextResponse.json(result);
});
