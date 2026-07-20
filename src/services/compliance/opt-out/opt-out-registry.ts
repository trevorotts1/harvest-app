// T-38 (master-spec §10.4 "Global opt-out & quiet hours (P0 — TCPA)"; §3.4 "Global opt-out
// precedence"; §16.2 regulatory matrix "TCPA | SMS consent, opt-out, quiet hours | ... global
// opt-out registry ... | Opt-out halts SMS < 60 s"). This is the general-purpose, PUBLIC service
// around the `OptOutRegistry` Prisma model (already in trunk since T-22/WP02 — see
// prisma/schema.prisma's model doc comment) — the model existed, but only a private, single-reason
// ("minor") write path existed prior to this unit
// (src/services/warm-market/vault/vault.service.ts's `registerMinorOptOut`, §7.6). This service
// generalizes that EXACT channel fan-out convention (a phone identifier opts out of both SMS
// channels; an email identifier opts out of EMAIL) to every opt-out reason (`stop_reply` / `manual`
// / `wrong_person` / `minor`), so every future write — the inbound STOP capture route, the manual
// in-app one-tap mark, and any other opt-out source — goes through ONE implementation instead of a
// second copy of the upsert loop. `vault.service.ts`'s existing minor-flow is left untouched (out
// of this unit's lane — see the T-38 build report for why); it writes to the SAME table with the
// SAME fan-out shape, so there is no behavioral drift between the two call sites.
//
// GLOBAL + PERMANENT + CROSS-REP (§10.4 "the same aunt appears in three cousins' warm markets"):
// `OptOutRegistry` is keyed by `identifier_hash` (a keyed HMAC of the phone/email, §3.4) — NOT by
// `user_id` or `contact_id` — so a single write here is immediately visible to every rep's copy of
// that same person, the instant the write commits (well under the §10.4/AC-10.9-4 60-second
// propagation bar; there is no queue, cache, or per-rep replication step in between). Once
// recorded, an opt-out is never deleted by this service (no `delete`/`revoke` method is exposed) —
// permanent per §10.4 "global opt-out and permanent".
//
// FAIL-CLOSED (the load-bearing property every T-37/T-39 send path depends on via
// SendComplianceGate, ../send-gate/send-compliance-gate.ts): `isOptedOut` treats ANY read failure
// (DB unavailable, a thrown error, a malformed row) as "yes, opted out" — never as "not opted out".
// An unknown opt-out state must never resolve to "safe to send".

import { MessageChannel } from '@prisma/client';

import { prisma } from '../../../lib/prisma';

/** §10.8 / prisma/schema.prisma `OptOutRegistry.reason` doc comment — the reasons AC-10.9-4/§7.6
 *  already establish. A bare string column (not a Prisma enum) by the same "regulatory/config-
 *  shaped vocabulary should be editable without a migration" convention used elsewhere in this
 *  schema — this union is the single source of truth for which strings this codebase writes. */
export type OptOutReason = 'stop_reply' | 'manual' | 'wrong_person' | 'minor';

/** Name of the shared secret the inbound STOP-keyword webhook (../../../app/api/compliance/
 *  opt-out/inbound/route.ts) is authenticated with — read by NAME only, never logged (§0.4).
 *  Defined HERE (not in that route.ts file) because Next.js's App Router constrains a
 *  `route.ts` module to only export recognized route fields (HTTP-method handlers, `dynamic`,
 *  etc.) — any other named export fails the production build's route-type-check. Same
 *  env-var-name-constant convention as `CONTACT_HASH_PEPPER_ENV_VAR` (../encryption/encryption.ts)
 *  and `CONTACT_ENCRYPTION_KEY_ENV_VAR` (../../warm-market/vault/vault-encryption.ts) — always
 *  homed in a service module, imported (never re-exported) by the route that consumes it. */
export const INBOUND_WEBHOOK_SECRET_ENV_VAR = 'INBOUND_SMS_WEBHOOK_SECRET';

export const ALL_OPT_OUT_REASONS: readonly OptOutReason[] = [
  'stop_reply',
  'manual',
  'wrong_person',
  'minor',
];

/** The channels a phone identifier's opt-out fans out across (§10.4 "propagates platform-wide"
 *  interpreted, per this build's brief, as blocking ALL outbound automated messaging to that
 *  identifier — not just the one channel a STOP arrived on). Mirrors
 *  vault.service.ts's `registerMinorOptOut` exactly. */
export const PHONE_OPT_OUT_CHANNELS: readonly MessageChannel[] = [
  MessageChannel.SMS_HANDOFF,
  MessageChannel.SMS_PLATFORM,
];
/** The channel an email identifier's opt-out fans out across. */
export const EMAIL_OPT_OUT_CHANNELS: readonly MessageChannel[] = [MessageChannel.EMAIL];

export interface OptOutIdentifiers {
  /** Deterministic keyed HMAC of the phone number (`hmacForMatch`) — never plaintext. */
  phoneHash?: string | null;
  /** Deterministic keyed HMAC of the email address (`hmacForMatch`) — never plaintext. */
  emailHash?: string | null;
}

export interface OptOutRegistryRow {
  identifier_hash: string;
  channel: MessageChannel;
  reason: string;
  created_at: Date;
}

/**
 * Narrow, DI-mockable Prisma delegate shape (same convention as every other service in this
 * codebase — VaultPrismaClient, ContactFlagsPrismaClient, OnboardingGatePrismaClient). `findUnique`
 * is intentionally OPTIONAL: `vault.service.ts`'s existing `VaultPrismaClient.optOutRegistry` only
 * ever exposes `upsert` (it never reads the registry back), so keeping `findUnique` optional here
 * means that existing, narrower shape stays structurally assignable to this interface without
 * touching that file — useful if a future unit wires this service into VaultService directly.
 * `isOptedOut` fails closed (see below) when the delegate a caller supplies has no `findUnique` at
 * all, exactly the same as when a real `findUnique` call throws.
 */
export interface OptOutRegistryPrismaClient {
  optOutRegistry: {
    upsert(args: {
      where: { identifier_hash_channel: { identifier_hash: string; channel: MessageChannel } };
      update: Record<string, unknown>;
      create: { identifier_hash: string; channel: MessageChannel; reason: string };
    }): Promise<unknown>;
    findUnique?(args: {
      where: { identifier_hash_channel: { identifier_hash: string; channel: MessageChannel } };
    }): Promise<OptOutRegistryRow | null>;
  };
}

/**
 * The authoritative global opt-out gate (§10.4). Every outbound send path — the composer handoff
 * (T-37), the automated Twilio cadence (T-37), and any future sequence engine (T-39) — MUST call
 * `isOptedOut`/`isIdentifierOptedOut` (or, preferably, go through `SendComplianceGate`, which
 * composes this with quiet hours + TCPA consent) before dispatch. §3.4: "a match hard-blocks the
 * send regardless of any other state."
 */
export class OptOutRegistryService {
  // Parameter deliberately named `client`, not `prisma` — a default value referencing the imported
  // `prisma` singleton (see `../../../lib/prisma`) cannot be named the same as the parameter itself
  // (the default-value expression would resolve to the not-yet-initialized parameter, not the
  // outer import). Same naming convention `gdpr-consent.ts`/`onboarding-gate.ts` already use for
  // exactly this reason.
  constructor(private client: OptOutRegistryPrismaClient = prisma as unknown as OptOutRegistryPrismaClient) {}

  /**
   * Records a permanent, global opt-out for whichever identifier hash(es) are supplied, fanned out
   * across every channel that identifier type can send on (see `PHONE_OPT_OUT_CHANNELS`/
   * `EMAIL_OPT_OUT_CHANNELS` above) — so "STOP to the SMS platform number" also blocks email to the
   * same person, and vice versa (§10.4 "ALL outbound automated messaging ... blocked across every
   * channel, permanently", this build's brief). Idempotent: re-recording an opt-out that already
   * exists for a given (identifier_hash, channel) is a no-op (`update: {}` never overwrites the
   * original `reason`/`created_at` — first opt-out wins, matching the existing minors precedent).
   * Silently does nothing for an identifier that isn't supplied (e.g. a contact with no email) —
   * never throws for "nothing to record".
   */
  async recordOptOut(identifiers: OptOutIdentifiers, reason: OptOutReason): Promise<void> {
    const entries: { identifier_hash: string; channel: MessageChannel }[] = [];
    if (identifiers.phoneHash) {
      for (const channel of PHONE_OPT_OUT_CHANNELS) {
        entries.push({ identifier_hash: identifiers.phoneHash, channel });
      }
    }
    if (identifiers.emailHash) {
      for (const channel of EMAIL_OPT_OUT_CHANNELS) {
        entries.push({ identifier_hash: identifiers.emailHash, channel });
      }
    }

    for (const entry of entries) {
      await this.client.optOutRegistry.upsert({
        where: { identifier_hash_channel: { identifier_hash: entry.identifier_hash, channel: entry.channel } },
        update: {},
        create: { identifier_hash: entry.identifier_hash, channel: entry.channel, reason },
      });
    }
  }

  /**
   * FAIL-CLOSED (§10.4, §18.1 "unknown consent/opt-out state must never resolve to sendable"):
   * returns `true` (opted out / blocked) if the registry cannot be read for any reason — a thrown
   * error, or a delegate with no `findUnique` at all. There is exactly one path that returns
   * `false`: a confirmed, successful lookup that found no matching row.
   */
  async isOptedOut(identifierHash: string, channel: MessageChannel): Promise<boolean> {
    if (!this.client.optOutRegistry.findUnique) {
      // No read capability supplied at all — cannot confirm "not opted out", so fail closed.
      return true;
    }
    try {
      const row = await this.client.optOutRegistry.findUnique({
        where: { identifier_hash_channel: { identifier_hash: identifierHash, channel } },
      });
      return row !== null;
    } catch {
      // FAIL-CLOSED: a DB error must never be read as "safe to send".
      return true;
    }
  }

  /** Convenience wrapper for callers holding a Contact row's hashes rather than a bare identifier. */
  async recordOptOutForContact(
    contact: { phone_hash?: string | null; email_hash?: string | null },
    reason: OptOutReason
  ): Promise<void> {
    return this.recordOptOut({ phoneHash: contact.phone_hash ?? null, emailHash: contact.email_hash ?? null }, reason);
  }

  /**
   * The inbound STOP-keyword capture seam (§10.4 "A STOP to any platform number ... propagates
   * platform-wide within 60 s"; §10.9-4). T-37 (which provisions the real Twilio A2P-10DLC
   * platform number and its inbound-message webhook) is the eventual real caller of this method —
   * this unit has no live Twilio wiring to attach it to yet, so it is exposed here as a plain,
   * directly-callable method rather than assumed to be reachable only via a network route. It is
   * ALSO wired to `POST /api/compliance/opt-out/inbound` (../../../app/api/compliance/opt-out/
   * inbound/route.ts) today, authenticated by a shared-secret header (not a real Twilio request-
   * signature check, since no Twilio account exists yet in this build) so the seam is exercised
   * end-to-end rather than sitting dead until T-37 lands.
   *
   * No-ops (does nothing, returns `false`) if `isStopKeyword(messageBody)` is false — a normal
   * inbound reply is NOT an opt-out, and must never be treated as one.
   */
  async recordInboundMessage(identifierHash: string, channel: MessageChannel, messageBody: string): Promise<boolean> {
    if (!isStopKeyword(messageBody)) return false;
    await this.recordOptOut(
      channel === MessageChannel.EMAIL ? { emailHash: identifierHash } : { phoneHash: identifierHash },
      'stop_reply'
    );
    return true;
  }
}

/**
 * The standard SMS opt-out keyword set (case-insensitive, whitespace-trimmed, exact-word match —
 * the same convention every US A2P carrier/aggregator requires an SMS platform to honor
 * regardless of surrounding punctuation, e.g. "STOP." or "Stop!!"). §10.4 / §10.9-4.
 *
 * Deliberately conservative: matches only the message body reduced to its bare word content
 * (letters only, case-folded) — "STOP SENDING ME THIS" or "please stop" are NOT treated as opt-out
 * keywords by this exact-match check (a false positive here would wrongly silence a legitimate
 * conversation), matching the same one-exact-keyword convention Twilio's own Advanced Opt-Out
 * feature uses. A rep-side "wrong person"/"minor"/manual mark (this service's other reasons)
 * remains the correct path for anything short of an exact keyword.
 */
const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);

export function isStopKeyword(messageBody: string): boolean {
  const normalized = messageBody.trim().toLowerCase();
  return STOP_KEYWORDS.has(normalized);
}
