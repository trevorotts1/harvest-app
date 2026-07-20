// T-43 (WP07 §12.7, §12.9-7) — POST /api/gamification/referrals/attribute: records the resulting
// introduction as a new, ATTRIBUTED Vault contact once the rep gets the referral. Ownership-scoped —
// a referral or referrer-contact belonging to someone else resolves to 404 (never 403 — no
// existence leak, §16.6).

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { ALL_RELATIONSHIP_TYPES, recordReferredContact, type ReferralRelationshipType } from '@/services/gamification/referral.service';

export const dynamic = 'force-dynamic';

interface AttributeBody {
  referralId?: string;
  referrerContactId?: string | null;
  firstName?: string;
  lastName?: string;
  relationshipType?: string;
}

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: AttributeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.referralId || !body.firstName || !body.relationshipType || !ALL_RELATIONSHIP_TYPES.includes(body.relationshipType as ReferralRelationshipType)) {
    return NextResponse.json({ error: '"referralId", "firstName", and a valid "relationshipType" are required.' }, { status: 400 });
  }

  const result = await recordReferredContact(
    prisma as never,
    identity.userId,
    body.referralId,
    body.referrerContactId ?? null,
    { firstName: body.firstName, lastName: body.lastName ?? '', relationshipType: body.relationshipType as ReferralRelationshipType }
  );
  if (!result) {
    // 404, never 403 — no existence leak for a referral/contact that isn't this rep's own (§16.6).
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  return NextResponse.json(result);
});
