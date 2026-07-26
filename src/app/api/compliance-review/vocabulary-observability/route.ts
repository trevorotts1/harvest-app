// T-R51 (OBSERVE variant) — GET /api/compliance-review/vocabulary-observability: read-only §0.5
// doctrine-vocabulary catch frequency for the caller's org-scoped downline, so the operator can see
// which forbidden terms fire and how often (to refine the list later). Same RBAC gate and the exact
// same org-scoping as GET /api/compliance-review (`compliance_audit.read`; UPLINE/RVP/ADMIN/DUAL) —
// this is an additive, read-only sibling view, never a wider-scoped one.
//
// This does NOT change, and cannot change, any block/release decision — the vocabulary hard-block
// fires identically regardless of `CFE_VOCABULARY_MODE`; this route only reads back the durable
// record of catches that mode already decided to keep (see `engine.ts`'s `buildVerdict` and
// `CfeAdjudicationService.listVocabularyObservability`).

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
      { error: 'Vocabulary observability is for team leads — reps see their own Approval Inbox.' },
      { status: 403 }
    );
  }

  const service = new CfeAdjudicationService({ prisma: prisma as unknown as CfeAdjudicationPrismaClient });
  const observability = await service.listVocabularyObservability({
    id: identity.userId,
    role: identity.role,
    organizationId: identity.organizationId,
  });

  return NextResponse.json(observability);
});
