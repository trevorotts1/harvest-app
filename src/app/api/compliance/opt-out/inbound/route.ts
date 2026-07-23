// T-38 (master-spec §10.4 "A STOP to any platform number ... propagates platform-wide within
// 60 s"; §10.9-4). `POST /api/compliance/opt-out/inbound` — the inbound STOP-keyword capture SEAM.
//
// This is a machine-to-machine webhook, not a rep-facing route — its eventual real caller is
// Twilio's inbound-SMS webhook once T-37 provisions the A2P-10DLC platform number, which this unit
// does not do (no live Twilio account/credentials exist yet anywhere in this codebase — see
// `OptOutRegistryService.recordInboundMessage`'s own doc comment). Because there is no live Twilio
// signature to validate yet, this route authenticates with a simple shared-secret header
// (`x-inbound-webhook-secret`, compared via `crypto.timingSafeEqual` against the
// `INBOUND_SMS_WEBHOOK_SECRET` env var, read by NAME only — never logged) instead of a
// session/role check — there IS no rep session on an inbound-carrier-webhook request, so
// `withRole`/`getCurrentSession` do not apply here the way they do on every OTHER route in this
// package. T-37 is expected to replace this check with real Twilio request-signature validation
// (`X-Twilio-Signature`) when it wires the live platform number; until then, this is a genuine,
// fail-closed authentication gate, not a placeholder/stub — a request with a missing or wrong
// secret is rejected before anything is read from it, and an UNCONFIGURED secret fails closed
// (rejects every request) rather than silently accepting everything.
//
// Deliberately does NOT read or trust any `x-user-*`/`x-auth-*`/`x-identity-*` header (there is no
// user identity on this request at all to trust or forge) — `scripts/verify-api-auth.mjs`'s guard
// is moot here by construction. `OptOutRegistryService` is constructed lazily, INSIDE the handler
// (never at module scope), matching every other per-request service in this codebase.

import { timingSafeEqual } from 'node:crypto';

import { MessageChannel } from '@prisma/client';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { hmacForMatch } from '@/services/compliance/encryption/encryption';
import { INBOUND_WEBHOOK_SECRET_ENV_VAR, OptOutRegistryService } from '@/services/compliance/opt-out/opt-out-registry';
import { PipelineService } from '@/services/warm-market/pipeline.service';
import { PipelineStage } from '@/types/warm-market';

export const dynamic = 'force-dynamic';

/**
 * FAIL-CLOSED: `false` (unauthenticated) if the secret is unconfigured, the header is missing, the
 * header doesn't match, OR the two values differ in length (an unequal-length `timingSafeEqual`
 * call throws, which must be caught here rather than crashing the request into a 500 that could
 * itself be an oracle for probing the secret's length).
 */
function isAuthenticSignature(req: NextRequest): boolean {
  const configured = process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR];
  if (!configured) return false;

  const provided = req.headers.get('x-inbound-webhook-secret');
  if (!provided) return false;

  const configuredBuf = Buffer.from(configured);
  const providedBuf = Buffer.from(provided);
  if (configuredBuf.length !== providedBuf.length) return false;

  try {
    return timingSafeEqual(configuredBuf, providedBuf);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthenticSignature(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Field names approximate Twilio's inbound-webhook shape (`From`/`Body`) lower-cased for this
  // seam's own JSON contract; T-37 adapts the exact parsing once it wires the real Twilio
  // form-urlencoded webhook payload.
  const { from, body: messageBody } = body as { from?: unknown; body?: unknown };
  if (!from || typeof from !== 'string' || typeof messageBody !== 'string') {
    return NextResponse.json({ error: '"from" and "body" are required' }, { status: 400 });
  }

  let phoneHash: string;
  try {
    phoneHash = hmacForMatch(from);
  } catch {
    // hmacForMatch fails closed (throws) if CONTACT_HASH_PEPPER is unset — never fall back to an
    // unkeyed hash for a value this sensitive.
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  // Lazy: constructed per-request, not at module scope (build-safety convention).
  const service = new OptOutRegistryService();
  const optedOut = await service.recordInboundMessage(phoneHash, MessageChannel.SMS_PLATFORM, messageBody);

  // T-R40 (§7.5): a normal (non-STOP) inbound reply is the REPLY-INGESTION event this ticket wires
  // — advance every contact this identifier matches to RESPONDED. `OptOutRegistry` is keyed by
  // `identifier_hash` GLOBALLY/cross-rep (see opt-out-registry.ts's own doc comment — "the same
  // aunt appears in three cousins' warm markets"), and this webhook carries no per-rep/per-number
  // disambiguation (`to`) yet either — so, exactly like the opt-out fan-out it sits beside, this
  // advances every rep's copy of the contact sharing this phone_hash, never just one. A STOP
  // (`optedOut === true`) is NOT treated as a reply — recordInboundMessage already routed it to the
  // opt-out registry above; advancing pipeline_stage on an opt-out would conflate "asked to be left
  // alone" with "responded," which `PipelineService.advanceStage`'s own do_not_contact/DORMANT
  // guard is deliberately never asked to arbitrate here.
  if (!optedOut) {
    const pipelineService = new PipelineService(prisma);
    const matches = await prisma.contact.findMany({ where: { phone_hash: phoneHash } });
    await Promise.all(matches.map((c) => pipelineService.advanceStage(c.id, PipelineStage.RESPONDED, new Date())));
  }

  return NextResponse.json({ optedOut });
}
