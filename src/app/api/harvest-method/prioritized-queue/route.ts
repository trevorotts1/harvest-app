import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { PrioritizedQueueService } from '@/services/harvest-method/prioritized-queue.service';

// T-26 (§8.1 Layer 3 / §8.2) — the full ritual-review list: readiness-sorted, INCLUDES the Excluded
// tier (this is the surface where the rep acknowledges each exclusion, §8.2 "each requires
// acknowledgment" / uiux §5.4 "never a silent removal"). The §8.3 action-queue (WP04-facing) is the
// separate route that omits Excluded entirely. Empty (`available: false`) until all three layers
// are complete — no short-circuit to a raw Vault list (§8.3).
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  try {
    // Lazy: constructed per-request, not at module scope, so `next build`'s page-data collection
    // (which imports this module) never triggers the constructor's fail-closed
    // `getContactEncryptionKey()` default read (T-26 build-integration fix).
    const service = new PrioritizedQueueService();
    const user = await prisma.user.findUnique({ where: { id: identity.userId }, select: { rank: true } });
    const result = await service.getQueue(identity.userId, identity.orgType, {
      includeExcluded: true,
      rank: user?.rank ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
