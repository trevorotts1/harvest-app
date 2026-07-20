// T-41 (WP06 §11.6 "Template system") — GET the 20+ doctrine-verified template library. Reads the
// in-code catalog directly (the source of truth — see templates.ts's header) and lazily ensures the
// DB mirror is in sync (idempotent upsert by unique key; harmless to repeat). Session-gated like
// every other WP06 surface — the template library is part of the gated content-authoring surface,
// not a public page.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import {
  CONTENT_TEMPLATES,
  ensureTemplatesSeeded,
  personalizationTierForTemplate,
  type ContentTemplatePrismaClient,
} from '@/services/social-content/templates';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async () => {
  await ensureTemplatesSeeded(prisma as unknown as ContentTemplatePrismaClient);
  const templates = CONTENT_TEMPLATES.map((t) => ({
    ...t,
    doctrineVerified: true,
    defaultPersonalizationTier: personalizationTierForTemplate(t.key),
  }));
  return NextResponse.json({ templates, count: templates.length });
});
