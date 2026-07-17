import { NextResponse } from 'next/server';
import { getAgentInventory } from '../../../services/agent-layer/agent.service';
// T-20 §6.10-1: downstream (WP04) route, now behind the real onboarding gate. It previously served
// a hardcoded `mock-user` inventory with no auth at all; it now resolves the caller from the
// verified session and refuses anyone who is not GATED_COMPLETE (see onboarding-gate.ts).
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';

// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as session/whoami/route.ts.
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  return NextResponse.json(await getAgentInventory(identity.userId));
});
