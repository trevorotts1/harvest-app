// T-38 (master-spec §10.4 TCPA consent ledger; §16.2 "TCPA | ... | Per-contact consent"; §16.3
// "a consent record per data type ... timestamped, versioned, revocable. Separate TCPA consent for
// SMS."). `POST`/`DELETE /api/compliance/messaging-consent` — the rep-initiated capture/revoke
// surface for a CONTACT's (recipient's) TCPA messaging consent, wired onto
// `MessagingConsentLedger` (../../../../services/compliance/messaging-consent/
// messaging-consent-ledger.ts). This is the per-contact counterpart to
// `/api/onboarding/consent`, which captures the platform USER's own account-level GDPR/WP11
// consent — a different subject entirely (see messaging-consent-ledger.ts's header comment).
//
// Same `withRole` real-session pattern as `/api/onboarding/consent` and
// `/api/compliance/opt-out`: this route never reads or trusts an `x-user-*`/`x-auth-*`/
// `x-identity-*` header, and re-verifies that `contactId` belongs to the CALLING rep's own Vault
// before any read/write — a forged `contactId` for another rep's contact gets a 404, never a
// consent record. `MessagingConsentLedger` is constructed lazily, INSIDE each handler (never at
// module scope), matching every other per-request service in this codebase.

import { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { withRole } from '@/lib/auth/with-role';
import { prisma } from '@/lib/prisma';
import {
  MessagingConsentLedger,
  type MessagingConsentSource,
} from '@/services/compliance/messaging-consent/messaging-consent-ledger';

const ALL_ROLES = Object.values(Role);
const VALID_SOURCES: readonly MessagingConsentSource[] = ['sms_keyword', 'web_form', 'manual_entry', 'api'];

export const dynamic = 'force-dynamic';

async function assertOwnedContact(contactId: string, userId: string): Promise<boolean> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, user_id: userId }, select: { id: true } });
  return contact !== null;
}

export const POST = withRole(ALL_ROLES, async (req: NextRequest, _ctx, session) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { contactId, given, source, metadata } = body as {
    contactId?: unknown;
    given?: unknown;
    source?: unknown;
    metadata?: unknown;
  };
  if (!contactId || typeof contactId !== 'string') {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
  }
  if (typeof given !== 'boolean') {
    return NextResponse.json({ error: '"given" must be a boolean' }, { status: 400 });
  }
  if (source !== undefined && !VALID_SOURCES.includes(source as MessagingConsentSource)) {
    return NextResponse.json({ error: `source must be one of: ${VALID_SOURCES.join(', ')}` }, { status: 400 });
  }
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
    return NextResponse.json({ error: '"metadata" must be a plain object' }, { status: 400 });
  }

  // Ownership check — never trust the caller's contactId without re-verifying it belongs to THIS
  // rep's own Vault (same 404-for-both-cases posture as /api/compliance/opt-out).
  if (!(await assertOwnedContact(contactId, session.user.id))) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  // Lazy: constructed per-request, not at module scope (build-safety convention).
  const ledger = new MessagingConsentLedger();
  const record = await ledger.captureConsent(session.user.id, contactId, given, {
    source: source as MessagingConsentSource | undefined,
    metadata: metadata as Record<string, unknown> | undefined,
  });

  return NextResponse.json({ given: record.given, version: record.version, timestamp: record.timestamp });
});

export const DELETE = withRole(ALL_ROLES, async (req: NextRequest, _ctx, session) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { contactId } = body as { contactId?: unknown };
  if (!contactId || typeof contactId !== 'string') {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
  }

  if (!(await assertOwnedContact(contactId, session.user.id))) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const ledger = new MessagingConsentLedger();
  const record = await ledger.revokeConsent(session.user.id, contactId);

  return NextResponse.json({ given: record.given, version: record.version, timestamp: record.timestamp });
});
