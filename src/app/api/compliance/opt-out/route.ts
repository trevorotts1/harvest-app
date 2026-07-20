// T-38 (master-spec §10.8 "STOP to the rep's personal number -> the rep marks it in-app one tap
// from the timeline (attested at onboarding)"; §10.8 "Number recycling ('wrong person') -> quick
// action purges the number and logs it"). `POST /api/compliance/opt-out` — the manual,
// rep-initiated half of the global opt-out registry (the OTHER half, the inbound STOP-keyword
// webhook, is `POST /api/compliance/opt-out/inbound`, a separate route with separate — non-session
// — authentication, since that caller is a machine, not a signed-in rep).
//
// Built on `withRole` (the REAL Auth.js session — mirrors `/api/onboarding/consent`'s pattern)
// exactly like every other real (non-legacy-header) route in this codebase: this route NEVER reads
// or trusts an `x-user-id`/`x-auth-*`/`x-identity-*` header (so `scripts/verify-api-auth.mjs`'s
// guard is moot here by construction), and the caller's identity comes only from
// `session.user.id`. Every role may mark their OWN contact's opt-out (there is no role-specific
// restriction on this action), so the allow-list is every role in the enum — same posture as
// `/api/onboarding/consent`.
//
// Ownership is re-verified server-side (`prisma.contact.findFirst({ where: { id, user_id } })`)
// before any opt-out write — a forged/guessed `contactId` belonging to a DIFFERENT rep's Vault
// must never let this rep record an opt-out (or, via the 404 response, even confirm that contact
// exists) using it. `OptOutRegistryService` is constructed lazily, INSIDE the handler (never at
// module scope) — the standard build-safety convention this codebase already follows for every
// per-request service (e.g. `/api/harvest-method/action-complete`'s `PrioritizedQueueService`).

import { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { withRole } from '@/lib/auth/with-role';
import { prisma } from '@/lib/prisma';
import { OptOutRegistryService, type OptOutReason } from '@/services/compliance/opt-out/opt-out-registry';

const ALL_ROLES = Object.values(Role);

// The two reasons THIS route is the legitimate write path for (§10.8). `stop_reply` is the inbound
// webhook's own reason (a rep never manually asserts "I received a STOP keyword" — that's derived
// from the message text itself); `minor` remains vault.service.ts's own concern (§7.6) and is not
// exposed as a rep-selectable reason here.
const REP_SELECTABLE_REASONS: readonly OptOutReason[] = ['manual', 'wrong_person'];

export const dynamic = 'force-dynamic';

export const POST = withRole(ALL_ROLES, async (req: NextRequest, _ctx, session) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { contactId, reason } = body as { contactId?: unknown; reason?: unknown };
  if (!contactId || typeof contactId !== 'string') {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
  }
  if (typeof reason !== 'string' || !REP_SELECTABLE_REASONS.includes(reason as OptOutReason)) {
    return NextResponse.json(
      { error: `reason must be one of: ${REP_SELECTABLE_REASONS.join(', ')}` },
      { status: 400 }
    );
  }

  // Ownership check — this contact must belong to the CALLING rep's own Vault. A forged contactId
  // for another rep's contact gets the same 404 as a nonexistent one; neither confirms nor denies
  // existence to a caller who does not own it.
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, user_id: session.user.id },
    select: { phone_hash: true, email_hash: true },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  // Lazy: constructed per-request, not at module scope (build-safety convention).
  const service = new OptOutRegistryService();
  await service.recordOptOutForContact(contact, reason as OptOutReason);

  return NextResponse.json({ optedOut: true, reason });
});
