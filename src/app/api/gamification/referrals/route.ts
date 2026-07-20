// T-43 (WP07 §12.7) — POST /api/gamification/referrals: drafts a relationship-typed referral script,
// CFE-cleared BEFORE it is ever returned to the rep (§12.9-7). A held/flagged/blocked draft returns
// `status: 'held'` with NO usable script text.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { ALL_RELATIONSHIP_TYPES, draftReferralScript, type ReferralChannel, type ReferralRelationshipType } from '@/services/gamification/referral.service';
import { readAnchorStatement } from '@/services/gamification/anchor';

export const dynamic = 'force-dynamic';

interface ReferralDraftBody {
  relationshipType?: string;
  channel?: string;
  includeDimeFraming?: boolean;
}

export const POST = withOnboardingGate(async (req, _ctx, session, identity) => {
  let body: ReferralDraftBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.relationshipType || !ALL_RELATIONSHIP_TYPES.includes(body.relationshipType as ReferralRelationshipType)) {
    return NextResponse.json({ error: `"relationshipType" must be one of: ${ALL_RELATIONSHIP_TYPES.join(', ')}.` }, { status: 400 });
  }
  if (body.channel !== 'SMS' && body.channel !== 'EMAIL') {
    return NextResponse.json({ error: '"channel" must be "SMS" or "EMAIL".' }, { status: 400 });
  }

  const anchor = await readAnchorStatement(prisma as never, identity.userId);
  const repFirstName = (session.user.name ?? '').trim().split(/\s+/)[0] || 'there';

  const result = await draftReferralScript(
    {
      userId: identity.userId,
      relationshipType: body.relationshipType as ReferralRelationshipType,
      channel: body.channel as ReferralChannel,
      repFirstName,
      anchorStatement: anchor,
      includeDimeFraming: Boolean(body.includeDimeFraming),
      userContext: { user_id: identity.userId, role: identity.role },
    },
    { db: prisma as never }
  );
  return NextResponse.json(result);
});
