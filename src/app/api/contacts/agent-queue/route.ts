// T-23 (§7.5 "Contact pipeline to agents"): the real contact→agent dequeue surface.
//
// `GET /api/contacts/agent-queue?status=ready&limit=N` returns contacts sorted by `segment_score`
// DESC with DECRYPTED relationship type + flags (§7.5) — this app's routes are not URL-versioned
// anywhere else (see /api/contacts/import, /api/contacts/pipeline), so this is the unversioned
// equivalent of the spec's illustrative `/api/v1/contacts/agent-queue` path, consistent with every
// other WP02 route.
//
// `POST /api/contacts/agent-queue` records the result of an agent's outreach (§7.5 "after outreach
// it updates last_contact_date and pipeline_stage") for exactly one of the CALLER's OWN contacts —
// ownership is verified against the session-derived user id before any mutation runs.
//
// Session-gated (withOnboardingGate) exactly like every other WP02 route: this file never reads
// `x-user-id` or any `x-user-*`/`x-auth-*`/`x-identity-*` header, so `scripts/verify-api-auth.mjs`'s
// forged-identity-header guard is moot here by construction — the only identity source is the
// verified Auth.js session (`identity.userId`, from `withOnboardingGate`).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { clampAgentQueueLimit, PipelineService } from '@/services/warm-market/pipeline.service';
import { PipelineStage } from '@/types/warm-market';

// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as session/whoami/route.ts.
export const dynamic = 'force-dynamic';

const VALID_PIPELINE_STAGES = new Set<string>(Object.values(PipelineStage));

interface RecordOutreachBody {
  contactId?: string;
  toStage?: string;
  contactedAt?: string;
}

// ── GET /api/contacts/agent-queue?status=ready&limit=N ──────────────────────────────────────────
// §7.7 AC-7: "the agent queue returns contacts sorted by segment score; deletion removes from all
// queues within 60 s" — this is a live query with no separate materialized queue (see
// PipelineService.getAgentQueue's doc comment), so a deleted/opted-out/paused/minor-flagged contact
// is gone from the very next call, comfortably inside that window.
export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const userId = identity.userId;

  const statusParam = req.nextUrl.searchParams.get('status') ?? 'ready';
  if (statusParam !== 'ready') {
    return NextResponse.json(
      { error: '"status" must be "ready" — the only supported agent-queue eligibility state (§7.5).' },
      { status: 400 }
    );
  }

  const limitParam = req.nextUrl.searchParams.get('limit');
  const requestedLimit = limitParam === null ? undefined : Number(limitParam);
  if (limitParam !== null && !Number.isFinite(requestedLimit)) {
    return NextResponse.json({ error: '"limit" must be a number.' }, { status: 400 });
  }
  const limit = clampAgentQueueLimit(requestedLimit);

  const pipelineService = new PipelineService(prisma);
  const contacts = await pipelineService.getAgentQueue(userId, { status: 'ready', limit });

  return NextResponse.json({
    status: 'ready',
    limit,
    count: contacts.length,
    contacts,
  });
});

// ── POST /api/contacts/agent-queue ───────────────────────────────────────────────────────────────
// §7.5: "after outreach it updates last_contact_date and pipeline_stage." Ownership of `contactId`
// is verified against the SESSION user id before any write — an agent run for rep A can never move
// rep B's contact, even if `contactId` were guessed or leaked (§3.4 per-rep isolation).
export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const userId = identity.userId;

  let body: RecordOutreachBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.contactId || typeof body.contactId !== 'string') {
    return NextResponse.json({ error: '"contactId" is required.' }, { status: 400 });
  }
  if (!body.toStage || !VALID_PIPELINE_STAGES.has(body.toStage)) {
    return NextResponse.json(
      { error: `"toStage" must be one of: ${[...VALID_PIPELINE_STAGES].join(', ')}` },
      { status: 400 }
    );
  }

  const owned = await prisma.contact.findFirst({ where: { id: body.contactId, user_id: userId } });
  if (!owned) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const pipelineService = new PipelineService(prisma);
  const updated = await pipelineService.recordOutreach({
    contactId: body.contactId,
    toStage: body.toStage as PipelineStage,
    contactedAt: body.contactedAt ? new Date(body.contactedAt) : undefined,
  });

  return NextResponse.json({
    contactId: updated.id,
    pipelineStage: updated.pipeline_stage,
    lastContactDate: updated.last_contact_date,
  });
});
