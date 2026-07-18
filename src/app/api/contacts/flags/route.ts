// T-28 — carried-forward from the WP02 gate: the `is_recruit_target` / `is_client` toggle
// write-path (uiux §4.6 contact card). Session-gated (`withOnboardingGate`, never `x-user-id`),
// ownership-checked (the contact must belong to the SESSION user), and the two flags are set
// INDEPENDENTLY — see `ContactFlagsService.setFlags`'s header comment for the write-path guarantee.
//
// Lazy: the service is constructed per-request, INSIDE the handler, not at module scope — the same
// build-safety convention `contacts/agent-queue/route.ts` and every `harvest-method/*/route.ts`
// route already follows (T-26's build-integration fix), so `next build`'s page-data collection
// (which imports every route module with no request in flight) never risks a module-scope
// construction throwing. This route's service needs no encryption key at all (the two flags are
// plain booleans, not PII), so there is no key-read hazard here either way — the lazy construction
// is kept purely for convention consistency with every sibling route.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ContactFlagsService, type ContactFlagsPrismaClient } from '@/services/warm-market/contact-flags.service';

// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as every sibling route.
export const dynamic = 'force-dynamic';

interface SetFlagsBody {
  contactId?: string;
  isRecruitTarget?: boolean;
  isClient?: boolean;
}

// ── PATCH /api/contacts/flags ────────────────────────────────────────────────────────────────────
// Body: { contactId, isRecruitTarget?, isClient? } — at least one of the two flags must be present.
// Each is applied independently: sending only `isRecruitTarget` never touches `is_client`, and vice
// versa (§4.6 "two independent flag toggles").
export const PATCH = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: SetFlagsBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.contactId || typeof body.contactId !== 'string') {
    return NextResponse.json({ error: '"contactId" is required.' }, { status: 400 });
  }
  if (body.isRecruitTarget !== undefined && typeof body.isRecruitTarget !== 'boolean') {
    return NextResponse.json({ error: '"isRecruitTarget" must be a boolean.' }, { status: 400 });
  }
  if (body.isClient !== undefined && typeof body.isClient !== 'boolean') {
    return NextResponse.json({ error: '"isClient" must be a boolean.' }, { status: 400 });
  }

  const service = new ContactFlagsService(prisma as unknown as ContactFlagsPrismaClient);
  const result = await service.setFlags(identity.userId, body.contactId, {
    isRecruitTarget: body.isRecruitTarget,
    isClient: body.isClient,
  });

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'At least one of "isRecruitTarget"/"isClient" must be provided.' },
      { status: 400 }
    );
  }

  return NextResponse.json(result);
});
