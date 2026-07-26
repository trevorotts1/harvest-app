// T-R23 (WP05 §10.8 LAUNCH-GATE closure) — POST /api/messaging/inbound: the REAL Twilio inbound-SMS
// webhook. Before this unit, `SequenceService.pauseOnReply` (../../../../services/messaging/
// sequence/sequence.service.ts) had NO live caller anywhere in the build — an inbound reply from a
// contact never paused their active outreach sequence(s), so the cadence engine (sequence-scheduled-
// run.ts) could fire the NEXT scheduled touch right on top of a human who had just replied (§10.8:
// "an inbound reply pauses the sequence — human response takes priority"). This route is that
// caller — the one genuinely-open code gap this unit closes.
//
// Machine-to-machine (Twilio, not a rep) — authenticated by a REAL `X-Twilio-Signature` check
// (`verifyTwilioRequestSignature`, ../../../../services/messaging/send/twilio-signature.ts),
// FAIL-CLOSED: an unconfigured `TWILIO_AUTH_TOKEN`, an unconfigured public origin (`NEXTAUTH_URL`),
// or a missing/malformed/forged signature, is rejected before a single field of the payload is
// trusted or a single query runs. This route reads no `x-user-*`/`x-auth-*`/`x-identity-*` header —
// nothing here for scripts/verify-api-auth.mjs to flag (the same posture as every other machine-to-
// machine webhook in this codebase: stripe/webhook, compliance/opt-out/inbound).
//
// SIGNED-URL RECONSTRUCTION (T-R23 QC fix #3): Twilio signs the EXACT public webhook URL configured
// in its console (`https://<canonical-host>/api/messaging/inbound`). Behind Vercel's proxy, the
// server-side `req.url` may report an internal host/proto that does NOT match what Twilio signed,
// which would false-REJECT genuine Twilio traffic. So the signature is verified against the
// CONFIGURED canonical public origin (`NEXTAUTH_URL` — the app's public base URL, already required
// by Auth.js) joined to this request's own path+query — NEVER a spoofable `Host`/`X-Forwarded-*`
// header (trusting those would let an attacker choose the signature base). If `NEXTAUTH_URL` is
// unset, the route FAILS CLOSED (rejects) rather than guessing the URL.
//
// PHONE MATCHING (T-R23 QC fix #1 — the CRITICAL defect): the vault stores `Contact.phone_hash` as
// `hmacForMatch(phone.replace(/\D/g,''))` — the RAW import digits, no `+`, no country-code logic
// (src/services/warm-market/vault/vault.service.ts's `upsertRow`). Twilio always delivers `From` in
// E.164 (`+15557778888`). Hashing the E.164 form directly (the pre-fix bug) never matched the
// stored digits-only hash, so pauseOnReply silently never fired AND an inbound STOP was recorded
// under a hash the outbound gate never checks (SendComplianceGate → OptOutRegistryService.isOptedOut
// keys off `Contact.phone_hash`) — i.e. STOP was not honored. FIX: derive the set of digit forms
// that could match whatever the vault stored — the bare digits, and the NANP 10-/11-digit variant
// (a rep who imported "(555) 777-8888" stored 10 digits; Twilio sends the 11-digit `1…` form) — hash
// EACH, look contacts up by `phone_hash IN {those hashes}`, and record any STOP opt-out under EACH
// (the matched contact's stored hash is provably one of them, so the outbound gate will find it).
//
// STOP/opt-out is NOT re-implemented here. `OptOutRegistryService.recordInboundMessage` (T-38/
// T-R40, already built and tested) is the one and only STOP-keyword-detection + opt-out-recording
// path in this codebase — this route calls it (once per candidate hash), exactly like the existing
// JSON-shaped `/api/compliance/opt-out/inbound` webhook already does, so there remains exactly one
// opt-out implementation, never two. This route adds ONLY the piece that was missing: on a NORMAL
// (non-STOP) reply, every matching contact's ACTIVE outreach sequence(s) are paused via
// `SequenceService.pauseOnReply`. (`/api/compliance/opt-out/inbound`'s own T-R40 pipeline-stage-
// advance-to-RESPONDED behavior is a separate, pre-existing feature this unit's brief does not ask
// for and does not touch here — a future unit may consolidate the two inbound entry points into
// one; that is out of this LAUNCH-GATE fix's scope.)
//
// Cross-rep fan-out matches the existing precedent (OptOutRegistry / T-R40's pipeline-advance):
// `Contact.phone_hash` is looked up GLOBALLY (not scoped to one rep), because the same phone number
// can be a Contact row in more than one rep's warm market — a reply pauses the sequence in EVERY
// rep's copy, not just one.
//
// FAIL-SAFE on every other error: an unknown sender, a contact with no active sequence, or a
// lookup/pause failure never crashes the request and NEVER triggers an outbound send from this path
// — each is logged (tags + non-PII identifiers only; never the raw phone number or message body)
// and the request resolves to Twilio's benign empty-TwiML "no reply" acknowledgement.
//
// Lazy, in-handler construction only (no module-scope key read / no service constructed at import
// time) — matching every other per-request service in this codebase.

import { MessageChannel } from '@prisma/client';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { hmacForMatch } from '@/services/compliance/encryption/encryption';
import { OptOutRegistryService } from '@/services/compliance/opt-out/opt-out-registry';
import { buildSequenceService } from '@/services/messaging/send/production-wiring';
import {
  TWILIO_SIGNATURE_HEADER,
  TwilioSignatureConfigError,
  TwilioSignatureError,
  verifyTwilioRequestSignature,
} from '@/services/messaging/send';

export const dynamic = 'force-dynamic';

/** Env var (by NAME only, §0.4) holding the app's canonical public origin — reused to reconstruct
 *  the exact URL Twilio signed (see the SIGNED-URL RECONSTRUCTION note above). Already required by
 *  Auth.js in production, so it is the single source of truth for "our public base URL". */
const PUBLIC_ORIGIN_ENV_VAR = 'NEXTAUTH_URL';

/** Twilio's documented "do nothing, don't auto-reply" acknowledgement — this route never sends an
 *  outbound message of its own, so every non-error response is this same empty TwiML document. */
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twimlAck(): NextResponse {
  return new NextResponse(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

/**
 * The digit forms that could match what the vault stored for this inbound number. The vault stores
 * `phone.replace(/\D/g,'')` verbatim (no country-code normalization), so a US contact may be stored
 * as bare 10 digits ("5557778888") OR 11 digits ("15557778888") depending purely on how the rep's
 * source list was formatted. Twilio always delivers E.164 ("+15557778888"). We therefore try the
 * exact digits AND the NANP 10↔11 variant so either stored form matches. International numbers
 * (not `1…`, not 10-digit) yield just their own digit string. Empty/garbage → no candidates.
 */
function phoneMatchCandidates(raw: string): string[] {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return [];
  const set = new Set<string>([digits]);
  if (digits.length === 11 && digits.startsWith('1')) set.add(digits.slice(1)); // 1XXXXXXXXXX -> XXXXXXXXXX
  if (digits.length === 10) set.add(`1${digits}`); // XXXXXXXXXX -> 1XXXXXXXXXX
  return [...set];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // The RAW form-encoded body is what Twilio signed — never re-serialize it before verifying.
  const rawBody = await req.text();
  const parsedParams = new URLSearchParams(rawBody);
  const params: Record<string, string> = {};
  for (const [key, value] of parsedParams.entries()) {
    params[key] = value;
  }

  // ── Gate: SIGNATURE (lazy, fail-closed). Reject BEFORE any field is read/trusted. ──
  // Reconstruct the signed URL from the CONFIGURED public origin + this request's path — not the
  // proxy-dependent `req.url`, and not spoofable headers.
  const publicOrigin = process.env[PUBLIC_ORIGIN_ENV_VAR];
  if (!publicOrigin) {
    // Cannot reconstruct the exact URL Twilio signed → cannot verify → fail closed.
    console.error(
      `[messaging][inbound-sms] ${PUBLIC_ORIGIN_ENV_VAR} is unset; cannot reconstruct the signed webhook URL — failing closed.`
    );
    return NextResponse.json({ error: 'Public origin is not configured.' }, { status: 401 });
  }
  const signedUrl = `${publicOrigin.replace(/\/+$/, '')}${req.nextUrl.pathname}${req.nextUrl.search}`;

  try {
    verifyTwilioRequestSignature({
      url: signedUrl,
      signatureHeader: req.headers.get(TWILIO_SIGNATURE_HEADER),
      params,
    });
  } catch (error) {
    if (error instanceof TwilioSignatureConfigError) {
      // TWILIO_AUTH_TOKEN unset — cannot verify anything; refuse rather than process unverifiably.
      return NextResponse.json({ error: 'Twilio inbound webhook is not configured.' }, { status: 401 });
    }
    if (error instanceof TwilioSignatureError) {
      // Missing / malformed / forged signature — never process an unsigned/forged inbound.
      return NextResponse.json({ error: 'Signature verification failed.' }, { status: 403 });
    }
    throw error;
  }

  const from = params.From;
  const messageBody = params.Body ?? '';
  const messageSid = params.MessageSid ?? null;

  if (!from) {
    // A verified-but-malformed payload (should not happen from real Twilio) — safe no-op ack.
    console.error('[messaging][inbound-sms] verified request missing "From"; no-op ack.', { messageSid });
    return twimlAck();
  }

  let candidateHashes: string[];
  try {
    // hmacForMatch fails closed (throws) if CONTACT_HASH_PEPPER is unset — never fall back to an
    // unkeyed hash for a value this sensitive (same posture as /api/compliance/opt-out/inbound).
    candidateHashes = phoneMatchCandidates(from).map((digits) => hmacForMatch(digits));
  } catch {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  if (candidateHashes.length === 0) {
    // Verified request whose From has no usable digits — safe no-op ack.
    console.error('[messaging][inbound-sms] verified request with unusable "From"; no-op ack.', { messageSid });
    return twimlAck();
  }

  try {
    // ── STOP/opt-out routing — reuse, never duplicate, the existing opt-out path. Record under
    // EVERY candidate hash so the opt-out is keyed to whatever form the vault stored (the matched
    // contact's stored `phone_hash` is provably one of these), which is exactly what the outbound
    // SendComplianceGate checks. recordInboundMessage no-ops (returns false) on a non-STOP reply. ──
    const optOutService = new OptOutRegistryService();
    let optedOut = false;
    for (const candidateHash of candidateHashes) {
      const wasStop = await optOutService.recordInboundMessage(candidateHash, MessageChannel.SMS_PLATFORM, messageBody);
      optedOut = optedOut || wasStop;
    }

    if (optedOut) {
      console.log('[messaging][inbound-sms] inbound STOP recorded via the existing opt-out path; no sequence action.', {
        messageSid,
      });
      return twimlAck();
    }

    // ── Normal reply: pause every matching contact's ACTIVE sequence(s) (§10.8). ──
    const contacts = await prisma.contact.findMany({
      where: { phone_hash: { in: candidateHashes } },
      select: { id: true, user_id: true },
    });

    if (contacts.length === 0) {
      // Unknown sender — safe no-op: no crash, no action, benign ack.
      return twimlAck();
    }

    const sequenceService = buildSequenceService(prisma);
    let pausedCount = 0;

    for (const contact of contacts) {
      let activeSequences: { id: string }[];
      try {
        activeSequences = await prisma.outreachSequence.findMany({
          where: { contact_id: contact.id, state: 'ACTIVE' },
          select: { id: true },
        });
      } catch (err) {
        // A lookup failure for one matched contact must never abort the others or crash the request.
        console.error('[messaging][inbound-sms] active-sequence lookup failed for a matched contact; skipping.', err);
        continue;
      }

      for (const seq of activeSequences) {
        try {
          const result = await sequenceService.pauseOnReply(contact.user_id, seq.id);
          if (result) pausedCount += 1;
        } catch (err) {
          // pauseOnReply failing for one sequence must never abort the others or crash the request.
          console.error('[messaging][inbound-sms] pauseOnReply failed for a sequence; skipping.', err);
        }
      }
    }

    console.log(`[messaging][inbound-sms] inbound reply processed; paused ${pausedCount} sequence(s).`, { messageSid });
    return twimlAck();
  } catch (err) {
    // Any other unexpected failure in the reply-processing path — never crash, never leave the
    // request unhandled, never trigger an outbound send. Twilio just gets its benign ack.
    console.error('[messaging][inbound-sms] unexpected error processing inbound reply.', err);
    return twimlAck();
  }
}
