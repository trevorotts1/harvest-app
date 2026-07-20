// T-37 — POST /api/messaging/platform-send: trigger an automated platform SMS send (Twilio A2P
// 10DLC) for a CFE-cleared, human-approved cadence draft (master-spec §10.1; §2.3 critical path).
// Body: `{ draftId: string }`. The organization is taken from the VERIFIED session
// (`session.user.organizationId`), never a client-forged header.
//
// Session-gated (withOnboardingGate). Ownership enforced inside the service (NOT_FOUND for another
// rep's draft/contact). EVERY service/client below is constructed HERE, per request, from lazily
// read config — the A2P/email deliverability services (wiring the T-36 `isChannelDeliverable`
// seam), the SendComplianceGate (T-38), and the Twilio messaging client (`createTwilioMessaging
// Client` returns null when TWILIO_* is unset → the service HOLDS the send: no send, no crash).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { PlatformSmsSendService } from '@/services/messaging/send';
import type { SendPrismaClient } from '@/services/messaging/send';
import { isChannelDeliverable } from '@/services/deliverability/gate';
import { A2PProvisioningService } from '@/services/deliverability/a2p-service';
import {
  PrismaA2PBrandRepository,
  PrismaA2PCampaignRepository,
  PrismaPlatformPhoneNumberRepository,
  type A2PBrandPrismaDelegate,
  type A2PCampaignPrismaDelegate,
  type PlatformPhoneNumberPrismaDelegate,
} from '@/services/deliverability/a2p-repository';
import { createTwilioClient } from '@/services/deliverability/twilio-client';
import { EmailDeliverabilityService } from '@/services/deliverability/email-deliverability-service';
import {
  PrismaEmailDomainAuthRepository,
  PrismaEmailWarmupRepository,
  type EmailDomainAuthPrismaDelegate,
  type EmailWarmupPlanPrismaDelegate,
} from '@/services/deliverability/email-warmup-repository';
import { DnsEmailAuthClient } from '@/services/deliverability/email-auth-client';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { draftId } = body as { draftId?: unknown };
  if (!draftId || typeof draftId !== 'string') {
    return NextResponse.json({ error: '"draftId" (a single string id) is required.' }, { status: 400 });
  }

  const organizationId = session.user.organizationId;
  if (!organizationId) {
    return NextResponse.json(
      { error: 'A platform send requires an organization on the session.', code: 'NO_ORGANIZATION' },
      { status: 400 }
    );
  }

  // Wire the real T-36 deliverability seam per request (mirrors src/app/api/admin/deliverability).
  const a2pService = new A2PProvisioningService(
    new PrismaA2PBrandRepository(prisma as unknown as { a2PBrandRegistration: A2PBrandPrismaDelegate }),
    new PrismaA2PCampaignRepository(prisma as unknown as { a2PCampaignRegistration: A2PCampaignPrismaDelegate }),
    new PrismaPlatformPhoneNumberRepository(prisma as unknown as { platformPhoneNumber: PlatformPhoneNumberPrismaDelegate }),
    createTwilioClient()
  );
  const emailService = new EmailDeliverabilityService(
    new PrismaEmailDomainAuthRepository(prisma as unknown as { emailDomainAuthentication: EmailDomainAuthPrismaDelegate }),
    new PrismaEmailWarmupRepository(prisma as unknown as { emailWarmupPlan: EmailWarmupPlanPrismaDelegate }),
    new DnsEmailAuthClient()
  );

  const service = new PlatformSmsSendService(prisma as unknown as SendPrismaClient, {
    checkDeliverable: (channel, orgId) => isChannelDeliverable({ a2pService, emailService }, channel, orgId),
  });

  const result = await service.send(identity.userId, draftId, organizationId);

  if (result.status === 'NOT_FOUND') {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }
  if (result.status === 'HELD') {
    return NextResponse.json(
      { error: 'This send is held — nothing was lost.', code: 'SEND_HELD', reason: result.reason },
      { status: 409 }
    );
  }
  if (result.status === 'FAILED') {
    return NextResponse.json({ error: 'The platform send failed.', code: 'SEND_FAILED' }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    messageId: result.messageId,
    deliveryStatus: result.deliveryStatus,
  });
});
