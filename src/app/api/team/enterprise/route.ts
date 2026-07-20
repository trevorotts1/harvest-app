// T-45 (WP09 §14.5 P1; uiux §5.9 item 7) — GET/PATCH /api/team/enterprise: the enterprise admin
// console shell (seats, latest org analytics narrative, onboarding/SSO config). RVP/ADMIN only
// (`enterprise_console`), org-scoped from the verified session — never a client-supplied org id.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { hasCapability } from '@/lib/auth/rbac';
import { EnterpriseConsoleService, type EnterpriseConsolePrismaClient } from '@/services/team-calendar/enterprise-console.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, session, identity) => {
  if (!hasCapability(session, 'enterprise_console', 'read')) {
    return NextResponse.json({ error: 'The enterprise console is for RVP/admin accounts.' }, { status: 403 });
  }
  if (!identity.organizationId) {
    return NextResponse.json({ error: 'No organization on file for this account.' }, { status: 400 });
  }

  const service = new EnterpriseConsoleService(prisma as unknown as EnterpriseConsolePrismaClient);
  const [seats, narrative, config] = await Promise.all([
    service.listSeats(identity.organizationId),
    service.getLatestNarrative(identity.organizationId),
    service.getConfig(identity.organizationId),
  ]);

  return NextResponse.json({ seats, narrative, config });
});

interface UpdateConfigBody {
  onboardingWelcomeMessage?: string | null;
  onboardingEnabledSteps?: unknown;
  ssoProvider?: string;
  ssoMetadataUrl?: string;
}

export const PATCH = withOnboardingGate(async (req, _ctx, session, identity) => {
  if (!hasCapability(session, 'enterprise_console', 'manage')) {
    return NextResponse.json({ error: 'The enterprise console is for RVP/admin accounts.' }, { status: 403 });
  }
  if (!identity.organizationId) {
    return NextResponse.json({ error: 'No organization on file for this account.' }, { status: 400 });
  }

  let body: UpdateConfigBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const service = new EnterpriseConsoleService(prisma as unknown as EnterpriseConsolePrismaClient);

  if (body.ssoProvider && body.ssoMetadataUrl) {
    await service.updateSsoConfig(identity.organizationId, body.ssoProvider, body.ssoMetadataUrl, identity.userId);
  }
  if (body.onboardingWelcomeMessage !== undefined || body.onboardingEnabledSteps !== undefined) {
    await service.updateOnboardingConfig(identity.organizationId, body.onboardingWelcomeMessage ?? null, body.onboardingEnabledSteps ?? null, identity.userId);
  }

  const config = await service.getConfig(identity.organizationId);
  return NextResponse.json({ config });
});
