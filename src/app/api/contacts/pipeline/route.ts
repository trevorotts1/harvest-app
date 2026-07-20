import { NextResponse } from 'next/server';
import { PIPELINE_STAGE_ORDER, PipelineStage, SAFE_HARBOR_EARNINGS_DISCLAIMER } from '@/types/warm-market';
// T-20 §6.10-1: downstream (WP02) route, behind the real onboarding gate (see briefing/route.ts).
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { PipelineService } from '@/services/warm-market/pipeline.service';

// T-R10 (remediation, flagged from T-28 QC + WP03 gate): this route used to return four HARDCODED
// illustrative contacts (an `_meta` flag marked the payload as such) regardless of who called it —
// the shipped `/community` page therefore showed those fixed contacts end-to-end, and a REAL flag
// toggle (T-28) 404'd against those fake ids on the live page. `PipelineService.getPipelineSummary`
// (T-23) is the real, session-scoped, ownership-filtered, DECRYPTED contact read this route was
// always meant to sit on top of — its own header comment already names the "Community home" plots
// as its purpose — it was simply never wired in here. This route now calls it directly: no
// hardcoded-contacts fallback, no schema change (every field it reads already exists on `Contact`).
//
// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as session/whoami/route.ts.
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const userId = identity.userId;

  // Lazy, in-handler construction (never module scope) — same build-safety convention as every
  // sibling WP02 route (agent-queue/route.ts, flags/route.ts): `next build`'s page-data collection
  // imports this module with no request in flight and no CONTACT_ENCRYPTION_KEY set, so nothing that
  // reads that key may run until a real request reaches this handler.
  const pipelineService = new PipelineService(prisma);
  const grouped = await pipelineService.getPipelineSummary(userId);

  const summary = PIPELINE_STAGE_ORDER.map((stage) => {
    const stageContacts = (grouped[stage] ?? []) as {
      id: string;
      firstName: string;
      lastName: string;
      segmentScore: number;
      isRecruitTarget: boolean;
      isClient: boolean;
    }[];
    return {
      stage,
      count: stageContacts.length,
      contacts: stageContacts.map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim() || 'Unnamed contact',
        relationshipStrength: c.segmentScore,
        isRecruitTarget: c.isRecruitTarget,
        isClient: c.isClient,
      })),
    };
  });

  const allContacts = summary.flatMap((s) => s.contacts);
  const totalContacts = allContacts.length;

  return NextResponse.json({
    userId,
    summary,
    totals: {
      contacts: totalContacts,
      appointmentReady: summary.find((s) => s.stage === PipelineStage.APPOINTMENT_CONFIRMED)?.count ?? 0,
      // No contacts is a legitimate empty state (a brand-new rep), not a divide-by-zero error — 0,
      // not NaN.
      averageRelationshipStrength:
        totalContacts === 0
          ? 0
          : Math.round(allContacts.reduce((total, contact) => total + contact.relationshipStrength, 0) / totalContacts),
    },
    safeHarbor: SAFE_HARBOR_EARNINGS_DISCLAIMER,
    _meta: {
      demo: false,
      sideEffects: 'none',
    },
  });
});
