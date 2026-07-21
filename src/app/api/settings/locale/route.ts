// T-53 (master-spec §17.5 / uiux §6.2 i18n) — Me -> Language's persistence route. Deliberately NOT
// wired through the NextAuth JWT/session claims (unlike role/orgType/accessTier): this is a
// low-stakes preference, not an authorization signal, so a plain per-request Prisma read/write
// keyed off the authenticated session's user id is proportionate — no session-callback change, no
// new JWT field, and (mirroring org-switch's own note) every read is always the live DB value, so a
// stale client session can never show a wrong preference.
//
// No step-up MFA: unlike org_switch (a `SensitiveAction`), changing a display-language preference
// has no compliance/security weight — any authenticated role may read or set their own.
import { Role } from '@prisma/client';
import { NextResponse } from 'next/server';

import { withRole } from '@/lib/auth/with-role';
import { isLocale } from '@/lib/i18n/locale';
import { prisma } from '@/lib/prisma';

const ANY_AUTHENTICATED_ROLE = Object.values(Role);

/** Force dynamic (request-time) rendering — same rationale as `/api/session/whoami`: a per-session
 *  response must never be statically cached across users, and `next build`'s static-optimization
 *  pass must not invoke this with a synthetic, session-less request. */
export const dynamic = 'force-dynamic';

export const GET = withRole(ANY_AUTHENTICATED_ROLE, async (_req, _ctx, session) => {
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { locale: true },
  });
  return NextResponse.json({ locale: user?.locale ?? null });
});

export const PATCH = withRole(ANY_AUTHENTICATED_ROLE, async (req, _ctx, session) => {
  const body = await req.json().catch(() => null);
  const locale = (body as { locale?: unknown } | null)?.locale;
  if (!isLocale(locale)) {
    return NextResponse.json({ error: '"locale" must be "en" or "es".' }, { status: 400 });
  }

  await prisma.user.update({ where: { id: session.user.id }, data: { locale } });
  return NextResponse.json({ ok: true, locale });
});
