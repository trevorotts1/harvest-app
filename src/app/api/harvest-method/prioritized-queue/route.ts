import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { PrioritizedQueueService } from '@/services/harvest-method/prioritized-queue.service';
import { AntiPatternBlockedError, rejectSortOverride } from '@/services/harvest-method/action-boundary';

// T-26 (§8.1 Layer 3 / §8.2) — the full ritual-review list: readiness-sorted, INCLUDES the Excluded
// tier (this is the surface where the rep acknowledges each exclusion, §8.2 "each requires
// acknowledgment" / uiux §5.4 "never a silent removal"). The §8.3 action-queue (WP04-facing) is the
// separate route that omits Excluded entirely. Empty (`available: false`) until all three layers
// are complete — no short-circuit to a raw Vault list (§8.3).
//
// T-27 (§8.5 "extraction-first sorting ... not a permitted sort mode"): same architectural block as
// the action-queue route — a client-requested alternate sort is rejected (400), never honored.
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    rejectSortOverride(req.nextUrl.searchParams);

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
    if (error instanceof AntiPatternBlockedError) {
      return NextResponse.json({ error: error.message, code: 'ANTI_PATTERN_BLOCKED', antiPattern: error.antiPattern }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
