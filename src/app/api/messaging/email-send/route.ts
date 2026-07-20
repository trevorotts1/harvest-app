// T-40R (WP05 GATE remediation, master-spec §10.5/§10.7; §10.9-6 CAN-SPAM) — POST
// /api/messaging/email-send: trigger an automated EMAIL send for a CFE-cleared, human-approved draft
// through the org's authenticated sending domain. Body: `{ draftId: string, subject?: string }`. The
// EMAIL analog of POST /api/messaging/platform-send, and gated identically inside `EmailSendService`:
//   (a) CFE-cleared + approved + unedited, (b) SendComplianceGate(EMAIL) allowed, (c)
//   isChannelDeliverable('EMAIL') — SPF/DKIM/DMARC VERIFIED + warm-up active.
// Missing RESEND_API_KEY → the client factory returns null → HELD (EMAIL_UNCONFIGURED): no send, no
// crash (fail-safe, §0.4). This route adds NO ungated path — it only calls the already-gated service.
//
// The organization is taken from the VERIFIED session (never a forged header); the authenticated
// sending domain is resolved from the org's own verified EmailDomainAuthentication rows (no domain →
// the service HELDs NO_SENDING_DOMAIN, never a guessed sender). Session-gated (withOnboardingGate);
// ownership enforced inside the service (another rep's draft → NOT_FOUND). Lazy, in-handler construction.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildEmailSendService, resolveOrgSendingDomain } from '@/services/messaging/send/production-wiring';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { draftId, subject } = body as { draftId?: unknown; subject?: unknown };
  if (!draftId || typeof draftId !== 'string') {
    return NextResponse.json({ error: '"draftId" (a single string id) is required.' }, { status: 400 });
  }
  if (subject !== undefined && typeof subject !== 'string') {
    return NextResponse.json({ error: '"subject" must be a string when provided.' }, { status: 400 });
  }

  const organizationId = session.user.organizationId;
  if (!organizationId) {
    return NextResponse.json(
      { error: 'An email send requires an organization on the session.', code: 'NO_ORGANIZATION' },
      { status: 400 }
    );
  }

  // The authenticated sending domain — resolved from the org's own VERIFIED domain rows. A null here
  // (no configured domain) makes the service HELD NO_SENDING_DOMAIN; a configured-but-unverified domain
  // is caught by gate (c) inside the service. Either way the route never guesses a sender.
  const sendingDomain = await resolveOrgSendingDomain(organizationId, prisma);

  const service = buildEmailSendService(prisma);
  const result = await service.send(
    identity.userId,
    draftId,
    organizationId,
    sendingDomain,
    typeof subject === 'string' ? subject : undefined
  );

  if (result.status === 'NOT_FOUND') {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }
  if (result.status === 'HELD') {
    return NextResponse.json(
      { error: 'This email send is held — nothing was lost.', code: 'SEND_HELD', reason: result.reason },
      { status: 409 }
    );
  }
  if (result.status === 'FAILED') {
    return NextResponse.json({ error: 'The email send failed.', code: 'SEND_FAILED' }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    messageId: result.messageId,
    providerId: result.providerId,
    deliveryStatus: result.deliveryStatus,
  });
});
