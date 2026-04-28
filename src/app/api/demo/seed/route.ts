import { NextRequest, NextResponse } from 'next/server';
import { SAFE_HARBOR_DISCLAIMERS } from '@/types/compliance';

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id') || 'demo-user';

  return NextResponse.json({
    userId,
    seeded: true,
    profile: {
      role: 'REP',
      orgType: 'PRIMERICA',
      intensity: 'STANDARD',
      dailyOperatingWindowMinutes: 30,
    },
    contacts: {
      total: 4,
      appointmentReady: 1,
      activeConversations: 3,
    },
    actionQueue: [
      'Approve Maya Johnson first-touch draft',
      'Review Derrick Miles appointment window',
      'Send Tasha Green compliance-safe nurture check-in',
    ],
    compliance: {
      mode: 'fail-closed',
      outboundSideEffects: false,
      disclaimer: SAFE_HARBOR_DISCLAIMERS.opportunity,
    },
    _meta: {
      demo: true,
      sideEffects: 'none',
      hint: 'This endpoint returns demo seed payload only; it does not write to external systems.',
    },
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
