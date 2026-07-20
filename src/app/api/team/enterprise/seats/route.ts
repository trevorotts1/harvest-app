// T-45 (WP09 §14.5) — POST/DELETE /api/team/enterprise/seats: enterprise seat-pool management.
// RVP/ADMIN only (`enterprise_console`/`org_seat_config`), org-scoped from the verified session.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { hasCapability } from '@/lib/auth/rbac';
import { EnterpriseConsoleService, type EnterpriseConsolePrismaClient } from '@/services/team-calendar/enterprise-console.service';

export const dynamic = 'force-dynamic';

interface AssignSeatBody {
  userId?: string;
}

export const POST = withOnboardingGate(async (req, _ctx, session, identity) => {
  if (!hasCapability(session, 'enterprise_console', 'manage')) {
    return NextResponse.json({ error: 'The enterprise console is for RVP/admin accounts.' }, { status: 403 });
  }
  if (!identity.organizationId) {
    return NextResponse.json({ error: 'No organization on file for this account.' }, { status: 400 });
  }

  let body: AssignSeatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.userId) {
    return NextResponse.json({ error: '"userId" is required.' }, { status: 400 });
  }

  // Defense-in-depth: the assigned user must be in the SAME organization — a seat can never be
  // granted to a member of a different org even if the caller supplies a valid user id elsewhere.
  const target = await prisma.user.findUnique({ where: { id: body.userId }, select: { organization_id: true } });
  if (!target || target.organization_id !== identity.organizationId) {
    return NextResponse.json({ error: 'That account is not in your organization.' }, { status: 404 });
  }

  const service = new EnterpriseConsoleService(prisma as unknown as EnterpriseConsolePrismaClient);
  const seat = await service.assignSeat(identity.organizationId, body.userId, identity.userId);
  return NextResponse.json({ seat }, { status: 201 });
});

export const DELETE = withOnboardingGate(async (req, _ctx, session, _identity) => {
  if (!hasCapability(session, 'enterprise_console', 'manage')) {
    return NextResponse.json({ error: 'The enterprise console is for RVP/admin accounts.' }, { status: 403 });
  }
  const seatId = req.nextUrl.searchParams.get('seatId');
  if (!seatId) {
    return NextResponse.json({ error: '"seatId" query param is required.' }, { status: 400 });
  }
  const service = new EnterpriseConsoleService(prisma as unknown as EnterpriseConsolePrismaClient);
  const seat = await service.revokeSeat(seatId);
  return NextResponse.json({ seat });
});
