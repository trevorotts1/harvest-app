// T-43 (WP07 §12.4) — GET /api/gamification/quote?slot=morning|midday|evening: delivers ONE
// org-scoped, anchor-personalized, CFE-cleared quote (§12.9-4 "every quote passes the CFE"). A
// held/unavailable CFE returns 200 with `status: 'held'` (the client shows the honest "agents
// resting" copy — never a fabricated quote, §18.6).

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { deliverQuote, type QuoteTimeSlot } from '@/services/gamification/quote.service';
import { readAnchorStatement } from '@/services/gamification/anchor';

export const dynamic = 'force-dynamic';

const VALID_SLOTS: QuoteTimeSlot[] = ['morning', 'midday', 'evening'];

export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const slotParam = req.nextUrl.searchParams.get('slot');
  const timeSlot: QuoteTimeSlot = VALID_SLOTS.includes(slotParam as QuoteTimeSlot) ? (slotParam as QuoteTimeSlot) : 'midday';

  const anchor = await readAnchorStatement(prisma as never, identity.userId);
  const result = await deliverQuote(
    {
      userId: identity.userId,
      // §0.4 rule 4 / §18.7: org-scope is read from the VERIFIED session identity, never a
      // client-supplied flag — this is the one place that decides whether Primerica-scoped quotes
      // are even eligible candidates.
      isPrimerica: identity.orgType === 'PRIMERICA',
      timeSlot,
      anchorStatement: anchor,
      userContext: { user_id: identity.userId, role: identity.role },
    },
    { db: prisma as never }
  );
  return NextResponse.json(result);
});
