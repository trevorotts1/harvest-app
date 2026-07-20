// T-45 (WP09 §14.5/§4.4) — POST /api/team/enterprise/narrative: triggers a fresh Opus-4.8-composed,
// CFE-gated org analytics narrative for the current period. RVP/ADMIN only. Off the per-message
// path by construction (a manual, infrequent RVP/admin action) — the periodic batched refresh runs
// via `calendar-sync-inngest.ts`'s sibling cron lane if/when a scheduled cadence is enabled; this
// route is the on-demand "refresh" affordance uiux §5.9 item 7's console surfaces.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { hasCapability } from '@/lib/auth/rbac';
import { EnterpriseConsoleService, type EnterpriseConsolePrismaClient, type OrgAnalyticsInputMetrics } from '@/services/team-calendar/enterprise-console.service';

export const dynamic = 'force-dynamic';

async function computeOrgMetrics(organizationId: string, periodStart: Date): Promise<OrgAnalyticsInputMetrics> {
  const members = await prisma.user.findMany({ where: { organization_id: organizationId }, select: { id: true, onboarding_status: true } });
  const memberIds = members.map((m) => m.id);
  if (memberIds.length === 0) {
    return { activeReps: 0, appointmentsHeld: 0, recruitsActivated: 0, totalSeatCostCents: 0 };
  }

  const [appointmentsHeld, recruitsActivated, agentRuns] = await Promise.all([
    prisma.appointment.count({ where: { rep_id: { in: memberIds }, status: 'HELD' } }),
    prisma.orgTreeEdge.count({ where: { sponsor_id: { in: memberIds }, is_recruit_confirmed: true } }),
    prisma.agentRun.findMany({ where: { user_id: { in: memberIds }, created_at: { gte: periodStart } }, select: { cost_cents: true } }),
  ]);

  return {
    activeReps: members.filter((m) => m.onboarding_status === 'GATED_COMPLETE').length,
    appointmentsHeld,
    recruitsActivated,
    totalSeatCostCents: agentRuns.reduce((sum, r) => sum + r.cost_cents, 0),
  };
}

export const POST = withOnboardingGate(async (_req, _ctx, session, identity) => {
  if (!hasCapability(session, 'enterprise_console', 'manage')) {
    return NextResponse.json({ error: 'The enterprise console is for RVP/admin accounts.' }, { status: 403 });
  }
  if (!identity.organizationId) {
    return NextResponse.json({ error: 'No organization on file for this account.' }, { status: 400 });
  }

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const metrics = await computeOrgMetrics(identity.organizationId, periodStart);

  const service = new EnterpriseConsoleService(prisma as unknown as EnterpriseConsolePrismaClient);
  const result = await service.generateNarrative(identity.organizationId, metrics, periodStart, now);

  if (result.status === 'unavailable') {
    return NextResponse.json({ status: 'unavailable', message: 'Org analytics are resting — the Claude connection is not configured. Nothing was lost.' }, { status: 503 });
  }
  if (result.status === 'held') {
    return NextResponse.json({ status: 'held', message: 'This narrative is held for review before it can be shown.' }, { status: 202 });
  }
  return NextResponse.json({ status: 'generated', narrativeText: result.narrativeText });
});
