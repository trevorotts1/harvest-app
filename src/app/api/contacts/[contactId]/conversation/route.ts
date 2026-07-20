// T-39 QC FIX 1 (uiux §5.7/§4.7 "rep-reachable conversation surface") — GET the per-contact
// conversation timeline. This is the real, session-scoped, ownership-checked, DECRYPTED read the
// `/community/[contactId]` page mounts `ConversationTimeline` on top of; before this fix the
// component/badge/handoff-card existed but nothing served real data to them (the QC-critical "rep
// cannot reach the conversation surface" finding).
//
// Session-gated via `withOnboardingGate` — the caller's identity comes from the VERIFIED Auth.js
// session, never a client-forged `x-user-id` (this route reads no such header, so a forged one is
// inert by construction). Ownership is enforced inside `ConversationTimelineService.getConversation`:
// a `contactId` not owned by the session user resolves to `null` here, which this route turns into a
// plain 404 — indistinguishable from "does not exist", never a leak of another rep's contact.
//
// Lazy, in-handler construction (never module scope) — same build-safety convention as every sibling
// WP02/WP05 route (contacts/pipeline, contacts/flags, messaging/compose-handoff): `next build`'s
// page-data collection imports this module with no request in flight and no CONTACT_ENCRYPTION_KEY
// set, so nothing that reads that key may run until a real request reaches this handler.
//
// Read-only: this route creates nothing and does not touch the send-gating backbone (send/,
// sequence/, objection/, handoff/'s write paths) — it only reads already-persisted, already-CFE-
// gated Message/ThreeWayHandoff/OutreachSequence/Contact rows.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ConversationTimelineService } from '@/services/messaging/conversation/conversation-timeline.service';
import type { ConversationTimelinePrismaClient } from '@/services/messaging/conversation/conversation-timeline.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate<{ params: { contactId: string } }>(async (_req, ctx, _session, identity) => {
  const contactId = ctx?.params?.contactId;
  if (!contactId || typeof contactId !== 'string') {
    return NextResponse.json({ error: '"contactId" is required.' }, { status: 400 });
  }

  const service = new ConversationTimelineService(prisma as unknown as ConversationTimelinePrismaClient);
  const result = await service.getConversation(identity.userId, contactId);

  if (!result) {
    // Never distinguish "does not exist" from "belongs to a different rep" — both resolve here.
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  return NextResponse.json(result);
});
