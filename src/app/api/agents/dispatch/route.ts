import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

// WP04 (T-30): enqueue an agent job onto the durable queue (Inngest, D-4). Session-gated via
// `withOnboardingGate` — the rep's identity comes from the VERIFIED Auth.js session, never a
// client-forged `x-user-id` header (this file reads no such header, so the forged-identity build
// guard is moot by construction, and a forged header is inert: `userId` below is the session's).
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ALL_AGENT_KEYS, AgentKey } from '@/services/agent-runtime/runtime-model-map';
import type { PersistedChannel } from '@/services/agent-runtime/store';

export const dynamic = 'force-dynamic';

const VALID_KEYS = new Set<string>(ALL_AGENT_KEYS);
const VALID_CHANNELS = new Set<PersistedChannel>(['SMS_HANDOFF', 'SMS_PLATFORM', 'EMAIL', 'SOCIAL_DM', 'IN_APP']);

interface DispatchBody {
  agentKey?: string;
  contactId?: string;
  channel?: string;
  task?: string;
  trigger?: string;
  idempotencyKey?: string;
  segmentContactId?: string;
}

export const POST = withOnboardingGate(async (req: NextRequest, _ctx, _session, identity) => {
  let body: DispatchBody;
  try {
    body = (await req.json()) as DispatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.agentKey || !VALID_KEYS.has(body.agentKey)) {
    return NextResponse.json({ error: 'Unknown or missing agentKey.', validKeys: [...VALID_KEYS] }, { status: 400 });
  }
  const channel = body.channel && VALID_CHANNELS.has(body.channel as PersistedChannel) ? (body.channel as PersistedChannel) : undefined;

  // Lazy: construct the Inngest-backed producer per-request (never at module scope, build-safety rule).
  const { InngestDurableQueue } = await import('@/services/agent-runtime/inngest-functions');
  const queue = new InngestDurableQueue();

  const idempotencyKey = body.idempotencyKey ?? randomUUID();
  await queue.send({
    agentKey: body.agentKey as AgentKey,
    userId: identity.userId, // ← the VERIFIED session identity, never a header
    trigger: body.trigger ?? 'manual_dispatch',
    idempotencyKey,
    contactId: body.contactId,
    channel,
    task: body.task,
    segmentContactId: body.segmentContactId,
  });

  return NextResponse.json({ enqueued: true, idempotencyKey, agentKey: body.agentKey }, { status: 202 });
});
