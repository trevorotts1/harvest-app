import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { PrioritizedQueueService } from '@/services/harvest-method/prioritized-queue.service';

// T-26 — marks a queue item actioned/dismissed. For a contact carrying the Layer-3 "existing
// licensee" soft-exclusion flag, this doubles as the required acknowledgment (§8.2).
export const dynamic = 'force-dynamic';

const service = new PrioritizedQueueService();

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    const { contactId } = await req.json();
    if (!contactId) return NextResponse.json({ error: 'contactId is required' }, { status: 400 });

    const result = await service.markActionComplete(identity.userId, contactId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
