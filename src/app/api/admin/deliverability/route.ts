import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Role } from '@prisma/client';

// T-36 (§10.3, SC5 launch gate) — the SC5 launch-gate provisioning-status surface: read-only A2P
// 10DLC (brand/campaign/number) status + email domain authentication/warm-up status ("list
// domains for org") for ops to confirm "deliverability is provisioned, not discovered" before
// launch. ADMIN-only, session-gated via `withRole` — mirrors src/app/api/agents/kill-switch/
// route.ts's auth pattern exactly: the caller's identity + role come from the VERIFIED Auth.js
// session, never a client-forged `x-user-id`/`x-organization-id` header (this route never reads
// either header at all, so a forged one is inert by construction).
import { withRole } from '@/lib/auth/with-role';
import { prisma } from '@/lib/prisma';
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

// GET /api/admin/deliverability?organizationId=...
//
// Every service/client below is constructed HERE, per request, from lazily-read env — never a
// module-scope client (see twilio-client.ts's `createTwilioClient`, which returns `null`, not a
// throw, when TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are unset; the A2P summary below then reports
// `twilioConfigured: false` and a NOT-deliverable readiness verdict rather than crashing or
// fabricating a "ready" status). `DnsEmailAuthClient` makes plain DNS TXT lookups — no
// credentials of its own to be missing.
export const GET = withRole([Role.ADMIN], async (req: NextRequest) => {
  const organizationId = req.nextUrl.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: '"organizationId" query parameter is required.' }, { status: 400 });
  }

  // The repository classes take a narrow, hand-written delegate interface (DI-mockable — see
  // a2p-repository.ts / email-warmup-repository.ts headers), not the full generated PrismaClient
  // type, so the real client is bridged in via the same `as unknown as { ... }` cast the one other
  // existing call-site of this pattern uses (src/services/harvest-method/prioritized-queue.service.ts,
  // wiring PrismaLicensingRepository) — the shared singleton `prisma` (not a fresh `new
  // PrismaClient()`) is used here to avoid opening a second connection pool per request.
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

  const [a2p, domains] = await Promise.all([
    a2pService.getProvisioningSummary(organizationId),
    emailService.listDomainsForOrganization(organizationId),
  ]);

  return NextResponse.json({ organizationId, a2p, email: { domains } });
});
