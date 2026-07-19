// T-33 — PATCH /api/contacts/controls: per-contact agent controls (master-spec §9.4; uiux §5.7
// "Pause agents for {name}" / "Do not contact"), each taking effect immediately (§9.9-5) — the very
// next `agent-runtime.ts` run for this contact reads the SAME `Contact.agents_paused`/
// `do_not_contact` columns this route writes. Session-gated (withOnboardingGate, never x-user-id);
// ownership is checked inside `ContactControlsService.setControls` before any write.
//
// Lazy: the service is constructed per-request, inside the handler, not at module scope — same
// build-safety convention as every sibling route (contacts/flags, harvest-method/action-complete).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ContactControlsService, type ContactControlsPrismaClient } from '@/services/approval-inbox/contact-controls.service';

export const dynamic = 'force-dynamic';

interface SetControlsBody {
  contactId?: string;
  agentsPaused?: boolean;
  doNotContact?: boolean;
}

export const PATCH = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: SetControlsBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.contactId || typeof body.contactId !== 'string') {
    return NextResponse.json({ error: '"contactId" is required.' }, { status: 400 });
  }
  if (body.agentsPaused !== undefined && typeof body.agentsPaused !== 'boolean') {
    return NextResponse.json({ error: '"agentsPaused" must be a boolean.' }, { status: 400 });
  }
  if (body.doNotContact !== undefined && typeof body.doNotContact !== 'boolean') {
    return NextResponse.json({ error: '"doNotContact" must be a boolean.' }, { status: 400 });
  }

  const service = new ContactControlsService(prisma as unknown as ContactControlsPrismaClient);
  const result = await service.setControls(identity.userId, body.contactId, {
    agentsPaused: body.agentsPaused,
    doNotContact: body.doNotContact,
  });

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'At least one of "agentsPaused"/"doNotContact" must be provided.' },
      { status: 400 }
    );
  }

  return NextResponse.json(result);
});
