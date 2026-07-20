// T-38 (master-spec §10.4 "Global opt-out & quiet hours (P0 — TCPA)"; qc-checklist WP05 block,
// checkpoint 4 "Global opt-out propagation" + checkpoint 5 "Recipient-timezone quiet hours";
// critical-failure conditions "A platform send with no opt-out check" / "Quiet hours keyed to the
// rep instead of the recipient").
//
// THE SEAM: this is the single choke point every WP05 outbound send path is required to call
// before dispatch (T-37's composer-handoff + automated-cadence Twilio send paths; T-39's sequence
// engine). `evaluate(contact, channel, now)` composes, in order:
//   1. Global opt-out (`OptOutRegistryService.isOptedOut`, ../opt-out/opt-out-registry.ts) —
//      permanent, cross-rep, every channel.
//   2. Recipient-timezone quiet hours (`isWithinQuietHours`, ../quiet-hours/quiet-hours.ts) —
//      8 AM–9 PM in the CONTACT's own timezone, never the rep's.
//   3. TCPA per-contact messaging consent (`MessagingConsentLedger.hasMessagingConsent`,
//      ../messaging-consent/messaging-consent-ledger.ts) — required for the automated Twilio
//      A2P-10DLC platform-number cadence (`MessageChannel.SMS_PLATFORM`) specifically; the rep's
//      own one-tap composer handoff (`SMS_HANDOFF`) is a human-confirmed send, not "automated
//      messaging" in the sense this consent record exists to gate (see messaging-consent-ledger.ts's
//      own header comment) — so it is not required there.
//
// DENY-BY-DEFAULT (this build's brief, verbatim: "single fail-closed evaluate(...) -> allowed |
// blocked+reason ... DENY-BY-DEFAULT (unknown/error -> blocked)"): every sub-check below is ALREADY
// individually fail-closed (see each module's own doc comment), and this gate additionally wraps
// the whole composition in a try/catch that resolves any unexpected throw — including one from a
// caller-supplied identifier being missing for the channel being sent on, so an opt-out check can't
// even be attempted — to `{ allowed: false, reason: 'ERROR' }`. There is exactly ONE path that
// returns `{ allowed: true }`: every sub-check ran to completion and every one of them cleared.
//
// Scope note: `MessageChannel` also has `SOCIAL_DM`/`IN_APP` members (prisma/schema.prisma) that
// have no established hashed-identifier opt-out convention (see opt-out-registry.ts's
// `PHONE_OPT_OUT_CHANNELS`/`EMAIL_OPT_OUT_CHANNELS` — only SMS_HANDOFF/SMS_PLATFORM/EMAIL are
// covered). §10.4/§10.9-4 govern SMS/email TCPA compliance specifically; this gate deliberately
// requires phoneHash for the two SMS channels and emailHash for EMAIL, and denies with 'ERROR' for
// any channel it has no established identifier convention for — deny-by-default, not silent bypass.

import { MessageChannel } from '@prisma/client';

import { OptOutRegistryService } from '../opt-out/opt-out-registry';
import { isWithinQuietHours } from '../quiet-hours/quiet-hours';
import { MessagingConsentLedger } from '../messaging-consent/messaging-consent-ledger';

/** The minimal shape `evaluate` needs from a recipient — deliberately a plain data bag (not the
 *  full, encrypted `Contact` Prisma row) so callers pass only what compliance checks require. */
export interface SendComplianceContact {
  /** The Contact's own id — required for the TCPA per-contact consent lookup. */
  contactId: string;
  /** Deterministic keyed HMAC of the phone number (`hmacForMatch`) — required to send on either
   *  SMS channel; never plaintext. */
  phoneHash?: string | null;
  /** Deterministic keyed HMAC of the email address (`hmacForMatch`) — required to send on EMAIL;
   *  never plaintext. */
  emailHash?: string | null;
  /** The contact's own IANA timezone id (`Contact.timezone`) — `null`/`undefined`/unrecognized
   *  fails closed (within quiet hours) per `isWithinQuietHours`. */
  timezone?: string | null;
}

export type SendComplianceBlockReason =
  /** §10.4/§3.4: a global, permanent, cross-channel opt-out is on file for this identifier. */
  | 'OPTED_OUT'
  /** §10.4/§10.9-5: it is currently outside the 8 AM–9 PM window in the recipient's OWN timezone
   *  (or the timezone could not be determined — fail-closed). */
  | 'QUIET_HOURS'
  /** §16.2/§16.3: no valid, current TCPA consent record for this contact (automated cadence only). */
  | 'NO_TCPA_CONSENT'
  /** Deny-by-default: the channel has no established identifier convention, the required
   *  identifier hash was not supplied, or a sub-check threw. Never resolves to "safe to send". */
  | 'ERROR';

export type SendComplianceResult =
  | { allowed: true }
  | { allowed: false; reason: SendComplianceBlockReason };

/** Channels whose automated-cadence dispatch requires TCPA per-contact messaging consent — see
 *  this file's header for why `SMS_HANDOFF` (the human-confirmed composer handoff) is excluded. */
const TCPA_CONSENT_REQUIRED_CHANNELS: ReadonlySet<MessageChannel> = new Set([MessageChannel.SMS_PLATFORM]);

/** Resolves the hashed identifier `evaluate` must check against `OptOutRegistry` for a given
 *  channel — `undefined` if this gate has no established identifier convention for that channel
 *  (see this file's header "Scope note"). */
function identifierHashForChannel(channel: MessageChannel, contact: SendComplianceContact): string | null | undefined {
  switch (channel) {
    case MessageChannel.SMS_HANDOFF:
    case MessageChannel.SMS_PLATFORM:
      return contact.phoneHash;
    case MessageChannel.EMAIL:
      return contact.emailHash;
    default:
      return undefined; // SOCIAL_DM / IN_APP — no covered identifier convention; deny-by-default below.
  }
}

/**
 * The unified send-compliance gate (§10.4). T-37 (SMS send paths — composer handoff + automated
 * cadence) and T-39 (sequence engine) MUST call `evaluate` before every outbound automated send —
 * this is the ONLY sanctioned way to consult opt-out + quiet hours + TCPA consent together. Neither
 * caller should call the three underlying sub-gates directly and reimplement the composition.
 *
 * Deliberately does NOT compose the content-level Compliance Filter Engine (CFE,
 * src/services/compliance/engine.ts) — that is a separate, orthogonal gate (income-claim/vocabulary
 * classification of the MESSAGE TEXT) that T-37/T-39 must ALSO consult; this gate governs whether
 * the RECIPIENT may be sent to at all, regardless of content.
 */
export class SendComplianceGate {
  constructor(
    private optOut: OptOutRegistryService = new OptOutRegistryService(),
    private consent: MessagingConsentLedger = new MessagingConsentLedger()
  ) {}

  async evaluate(
    contact: SendComplianceContact,
    channel: MessageChannel,
    now: Date = new Date()
  ): Promise<SendComplianceResult> {
    try {
      // 1. Opt-out — resolve the channel-appropriate identifier hash first. No identifier (or no
      // established convention for this channel) means the opt-out check cannot be performed, so
      // deny-by-default rather than silently skip it.
      const identifierHash = identifierHashForChannel(channel, contact);
      if (!identifierHash) {
        return { allowed: false, reason: 'ERROR' };
      }
      const optedOut = await this.optOut.isOptedOut(identifierHash, channel);
      if (optedOut) {
        return { allowed: false, reason: 'OPTED_OUT' };
      }

      // 2. Quiet hours — recipient-local, fail-closed on unknown/invalid timezone.
      if (isWithinQuietHours(contact.timezone, now)) {
        return { allowed: false, reason: 'QUIET_HOURS' };
      }

      // 3. TCPA consent — automated-cadence channels only (see TCPA_CONSENT_REQUIRED_CHANNELS).
      if (TCPA_CONSENT_REQUIRED_CHANNELS.has(channel)) {
        const hasConsent = await this.consent.hasMessagingConsent(contact.contactId);
        if (!hasConsent) {
          return { allowed: false, reason: 'NO_TCPA_CONSENT' };
        }
      }

      return { allowed: true };
    } catch {
      // Deny-by-default: any unexpected throw from a sub-check (a DB error not already caught
      // internally, a malformed input, etc.) must never resolve to "safe to send".
      return { allowed: false, reason: 'ERROR' };
    }
  }
}
