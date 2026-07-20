// T-41 (WP06 §11.4, AC §11.8-3 "generates as one coherent batch within 60 s of the new-member
// trigger") — the rep-facing REAL production caller (in addition to the automatic
// launchKitAutoTriggerFunction cron sweep, inngest-functions.ts). Body:
// `{ newMemberFirstName: string, welcomeVariant: 'PERSONAL_REFERRAL'|'EVENT_ATTENDEE'|'BASE_MEMBER_INTRODUCED',
//    newMemberContactId?: string, version?: 'V1_STANDARD'|'V2_TESTIMONIAL_ANCHORED'|'V3_EVENT_CENTRIC',
//    photoUrl?: string }`.
//
// `photoUrl` (§11.4/§11.8-10, "the rep's real onboarding photo") — this route does not fabricate one:
// if the caller omits it, it falls back to the SESSION rep's own `User.image` (their real onboarding
// photo, if one was chosen); if that is also null, the kit generates with `photoUrl: null` and the
// launch-kit UI renders the same initials-avatar fallback onboarding already uses — never a stock
// substitute.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildLaunchKitService } from '@/services/social-content/production-wiring';
import { AgentModelError, AgentModelTimeoutError, MissingClaudeCredentialError } from '@/services/agent-runtime/claude';
import type { LaunchKitVersion, WelcomeVariant } from '@prisma/client';

export const dynamic = 'force-dynamic';

const WELCOME_VARIANTS: WelcomeVariant[] = ['PERSONAL_REFERRAL', 'EVENT_ATTENDEE', 'BASE_MEMBER_INTRODUCED'];
const VERSIONS: LaunchKitVersion[] = ['V1_STANDARD', 'V2_TESTIMONIAL_ANCHORED', 'V3_EVENT_CENTRIC'];

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const newMemberFirstName = body.newMemberFirstName;
  if (typeof newMemberFirstName !== 'string' || newMemberFirstName.trim().length === 0) {
    return NextResponse.json({ error: '"newMemberFirstName" (string) is required.' }, { status: 400 });
  }
  const welcomeVariant = body.welcomeVariant;
  if (!WELCOME_VARIANTS.includes(welcomeVariant as WelcomeVariant)) {
    return NextResponse.json({ error: `"welcomeVariant" must be one of ${WELCOME_VARIANTS.join(', ')}` }, { status: 400 });
  }
  const version = body.version;
  if (version !== undefined && !VERSIONS.includes(version as LaunchKitVersion)) {
    return NextResponse.json({ error: `"version" must be one of ${VERSIONS.join(', ')}` }, { status: 400 });
  }

  let photoUrl: string | null = typeof body.photoUrl === 'string' ? body.photoUrl : null;
  if (!photoUrl) {
    const user = await prisma.user.findUnique({ where: { id: identity.userId }, select: { image: true } });
    photoUrl = user?.image ?? null;
  }

  const service = buildLaunchKitService(prisma);
  try {
    const startedAt = Date.now();
    const result = await service.triggerKit({
      userId: identity.userId,
      newMemberContactId: typeof body.newMemberContactId === 'string' ? body.newMemberContactId : null,
      newMemberFirstName,
      welcomeVariant: welcomeVariant as WelcomeVariant,
      version: version as LaunchKitVersion | undefined,
      photoUrl,
    });
    return NextResponse.json({ ...result, generationMs: Date.now() - startedAt }, { status: 201 });
  } catch (err) {
    if (err instanceof MissingClaudeCredentialError) {
      return NextResponse.json(
        { error: 'Held: your agents are resting — the Claude connection is not configured. Nothing was lost.' },
        { status: 503 }
      );
    }
    if (err instanceof AgentModelTimeoutError || err instanceof AgentModelError) {
      return NextResponse.json({ error: 'Generation failed — nothing was lost. Try again shortly.' }, { status: 502 });
    }
    throw err;
  }
});
