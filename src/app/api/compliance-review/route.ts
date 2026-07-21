// T-09 (master-spec §5.5 AC-3b/AC-1; §8.7.1) — GET /api/compliance-review: the UPLINE's actionable
// CFE FLAG-review queue. Session-gated (`withOnboardingGate`, never x-user-id); RBAC via the §16.6
// `compliance_audit.read` capability (UPLINE/RVP/ADMIN + DUAL union — a plain rep has no downline to
// review). Strict org-scoping is enforced inside `CfeAdjudicationService.listUplineQueue` (a rep
// outside the caller's scope never appears — no cross-org leak).
//
// Each item carries the classifier-by-classifier confidences, risk score, and the ADVISORY
// Sonnet/Opus recommendation + suggested rewrite (AC-1) — the data the Approval Inbox's
// ClassifierAdjudicationDrawer renders.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { hasCapability } from '@/lib/auth/rbac';
import {
  CfeAdjudicationService,
  type CfeAdjudicationPrismaClient,
} from '@/services/compliance/adjudication';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, session, identity) => {
  if (!hasCapability(session, 'compliance_audit', 'read')) {
    return NextResponse.json(
      { error: 'Compliance review is for team leads — reps see their own Approval Inbox.' },
      { status: 403 }
    );
  }

  const service = new CfeAdjudicationService({ prisma: prisma as unknown as CfeAdjudicationPrismaClient });
  const items = await service.listUplineQueue({
    id: identity.userId,
    role: identity.role,
    organizationId: identity.organizationId,
  });

  return NextResponse.json({ items });
});
