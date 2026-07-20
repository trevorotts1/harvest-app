// T-43 (WP07 §12.8) — GET /api/gamification/course: the Downline Maxxing course catalog + this
// rep's own progress. Ships placeholder-plus-roadmap (a DISCLOSED v1 scope decision, §1.6) — the
// roadmap disclosure string is included so the client renders it honestly rather than looking
// under-construction (uiux §6.6).

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { getCourseProgress } from '@/services/gamification/course.service';
import { ROADMAP_DISCLOSURE } from '@/services/gamification/course-catalog';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const modules = await getCourseProgress(prisma as never, identity.userId);
  return NextResponse.json({ modules, roadmapDisclosure: ROADMAP_DISCLOSURE });
});
