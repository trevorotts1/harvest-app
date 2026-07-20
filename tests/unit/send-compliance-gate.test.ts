// T-38 (master-spec §10.4; qc-checklist WP05 checkpoints 4/5; critical-failure conditions "A
// platform send with no opt-out check" / "Quiet hours keyed to the rep instead of the recipient").
//
// PROOF (d): the unified `SendComplianceGate.evaluate` composes opt-out + quiet-hours + TCPA
// consent, DENY-BY-DEFAULT. The four "isolates exactly one reason" tests below are the mutation
// proof required by this build's brief ("mutation: remove any sub-gate -> a test fails"): each
// test holds every OTHER sub-check in its PASSING state and only one sub-check in its BLOCKING
// state, then asserts the gate blocks for exactly that reason. If a future edit deleted the
// opt-out check from `evaluate()`, the "isolates OPTED_OUT" test would flip from blocked to
// allowed and fail; same for quiet-hours and TCPA consent — there is no way to silently drop one
// of the three sub-gates without breaking one of these tests.

import { MessageChannel } from '@prisma/client';

import { SendComplianceGate, type SendComplianceContact } from '../../src/services/compliance/send-gate/send-compliance-gate';
import { OptOutRegistryService, type OptOutRegistryPrismaClient, type OptOutRegistryRow } from '../../src/services/compliance/opt-out/opt-out-registry';
import { MessagingConsentLedger, type MessagingConsentPrismaClient } from '../../src/services/compliance/messaging-consent/messaging-consent-ledger';

// A fixed instant that is 8 AM in America/Chicago on 2026-07-15 — i.e. OUTSIDE quiet hours for a
// contact in that timezone (see quiet-hours.test.ts's own worked example for this exact instant).
const CLEAR_SEND_TIME = new Date('2026-07-15T13:00:00Z');
// A fixed instant that is 3 AM in America/Chicago on the same date — WITHIN quiet hours.
const QUIET_HOURS_SEND_TIME = new Date('2026-07-15T08:00:00Z');

function makeOptOutClient(preOptedOut: { identifierHash: string; channel: MessageChannel }[] = []): OptOutRegistryPrismaClient {
  const rows = new Map<string, OptOutRegistryRow>();
  for (const { identifierHash, channel } of preOptedOut) {
    rows.set(`${identifierHash}::${channel}`, {
      identifier_hash: identifierHash,
      channel,
      reason: 'stop_reply',
      created_at: new Date(),
    });
  }
  return {
    optOutRegistry: {
      upsert: jest.fn(),
      findUnique: jest.fn(async ({ where }) => {
        const key = `${where.identifier_hash_channel.identifier_hash}::${where.identifier_hash_channel.channel}`;
        return rows.get(key) ?? null;
      }),
    },
  };
}

function makeConsentClient(consentedContactIds: string[] = []): MessagingConsentPrismaClient {
  return {
    complianceConsent: {
      create: jest.fn(),
      findFirst: jest.fn(async ({ where }) => {
        if (!consentedContactIds.includes(where.contact_id)) return null;
        return {
          id: 'cc-1',
          user_id: 'rep-1',
          contact_id: where.contact_id,
          consent_type: where.consent_type,
          given: true,
          version: 1,
          timestamp: new Date(),
        };
      }),
      findMany: jest.fn(async () => []),
    },
  };
}

function makeGate(opts: {
  optedOut?: { identifierHash: string; channel: MessageChannel }[];
  consentedContactIds?: string[];
}): SendComplianceGate {
  const optOut = new OptOutRegistryService(makeOptOutClient(opts.optedOut ?? []));
  const consent = new MessagingConsentLedger(makeConsentClient(opts.consentedContactIds ?? []));
  return new SendComplianceGate(optOut, consent);
}

const CLEAR_CONTACT: SendComplianceContact = {
  contactId: 'contact-clear',
  phoneHash: 'hash-clear',
  emailHash: 'email-clear',
  timezone: 'America/Chicago',
};

describe('SendComplianceGate.evaluate — the unified seam (§10.4 — PROOF d)', () => {
  test('all three sub-gates clear -> allowed', async () => {
    const gate = makeGate({ consentedContactIds: ['contact-clear'] });
    const result = await gate.evaluate(CLEAR_CONTACT, MessageChannel.SMS_PLATFORM, CLEAR_SEND_TIME);
    expect(result).toEqual({ allowed: true });
  });

  describe('mutation proof: isolating exactly ONE blocking sub-gate at a time', () => {
    test('isolates OPTED_OUT — quiet-hours and TCPA consent both clear, only opt-out blocks', async () => {
      const gate = makeGate({
        optedOut: [{ identifierHash: 'hash-clear', channel: MessageChannel.SMS_PLATFORM }],
        consentedContactIds: ['contact-clear'], // TCPA consent WOULD pass
      });
      // CLEAR_SEND_TIME is outside quiet hours too — the ONLY reason this blocks is opt-out.
      const result = await gate.evaluate(CLEAR_CONTACT, MessageChannel.SMS_PLATFORM, CLEAR_SEND_TIME);
      expect(result).toEqual({ allowed: false, reason: 'OPTED_OUT' });
    });

    test('isolates QUIET_HOURS — opt-out and TCPA consent both clear, only the send time blocks', async () => {
      const gate = makeGate({
        optedOut: [], // not opted out
        consentedContactIds: ['contact-clear'], // TCPA consent WOULD pass
      });
      const result = await gate.evaluate(CLEAR_CONTACT, MessageChannel.SMS_PLATFORM, QUIET_HOURS_SEND_TIME);
      expect(result).toEqual({ allowed: false, reason: 'QUIET_HOURS' });
    });

    test('isolates NO_TCPA_CONSENT — opt-out clear, outside quiet hours, only missing consent blocks (automated SMS_PLATFORM channel)', async () => {
      const gate = makeGate({
        optedOut: [],
        consentedContactIds: [], // no consent on file
      });
      const result = await gate.evaluate(CLEAR_CONTACT, MessageChannel.SMS_PLATFORM, CLEAR_SEND_TIME);
      expect(result).toEqual({ allowed: false, reason: 'NO_TCPA_CONSENT' });
    });
  });

  test('DENY-BY-DEFAULT: a channel with no established identifier convention (SOCIAL_DM) is blocked with reason ERROR, never silently allowed', async () => {
    const gate = makeGate({ consentedContactIds: ['contact-clear'] });
    const result = await gate.evaluate(CLEAR_CONTACT, MessageChannel.SOCIAL_DM, CLEAR_SEND_TIME);
    expect(result).toEqual({ allowed: false, reason: 'ERROR' });
  });

  test('DENY-BY-DEFAULT: missing the required identifier hash for the channel (no phoneHash for an SMS send) blocks with ERROR', async () => {
    const gate = makeGate({ consentedContactIds: ['contact-clear'] });
    const contactWithNoPhone: SendComplianceContact = { ...CLEAR_CONTACT, phoneHash: null };
    const result = await gate.evaluate(contactWithNoPhone, MessageChannel.SMS_PLATFORM, CLEAR_SEND_TIME);
    expect(result).toEqual({ allowed: false, reason: 'ERROR' });
  });

  test('DENY-BY-DEFAULT: an unexpected throw from a sub-gate resolves to blocked (ERROR), never allowed', async () => {
    const throwingOptOut = {
      isOptedOut: jest.fn(async () => {
        throw new Error('unexpected');
      }),
    } as unknown as OptOutRegistryService;
    const consent = new MessagingConsentLedger(makeConsentClient(['contact-clear']));
    const gate = new SendComplianceGate(throwingOptOut, consent);

    const result = await gate.evaluate(CLEAR_CONTACT, MessageChannel.SMS_PLATFORM, CLEAR_SEND_TIME);
    expect(result).toEqual({ allowed: false, reason: 'ERROR' });
  });

  test('the SMS_HANDOFF (human-confirmed composer) channel does NOT require TCPA consent — only opt-out + quiet hours apply', async () => {
    const gate = makeGate({ optedOut: [], consentedContactIds: [] /* no TCPA consent on file */ });
    const result = await gate.evaluate(CLEAR_CONTACT, MessageChannel.SMS_HANDOFF, CLEAR_SEND_TIME);
    expect(result).toEqual({ allowed: true });
  });

  test('opt-out on SMS_HANDOFF still blocks it (opt-out is genuinely all-channel, unlike TCPA consent)', async () => {
    const gate = makeGate({
      optedOut: [{ identifierHash: 'hash-clear', channel: MessageChannel.SMS_HANDOFF }],
    });
    const result = await gate.evaluate(CLEAR_CONTACT, MessageChannel.SMS_HANDOFF, CLEAR_SEND_TIME);
    expect(result).toEqual({ allowed: false, reason: 'OPTED_OUT' });
  });

  test('EMAIL channel is gated by the email hash, independent of the phone hash\'s opt-out state', async () => {
    const gate = makeGate({
      optedOut: [{ identifierHash: 'hash-clear', channel: MessageChannel.SMS_PLATFORM }], // phone opted out
    });
    // Email identifier was never opted out — EMAIL send clears (no TCPA requirement on EMAIL either).
    const result = await gate.evaluate(CLEAR_CONTACT, MessageChannel.EMAIL, CLEAR_SEND_TIME);
    expect(result).toEqual({ allowed: true });
  });

  test('an unknown-timezone contact fails closed on an automated send even with clean opt-out/consent state', async () => {
    const gate = makeGate({ consentedContactIds: ['contact-clear'] });
    const unknownTzContact: SendComplianceContact = { ...CLEAR_CONTACT, timezone: null };
    const result = await gate.evaluate(unknownTzContact, MessageChannel.SMS_PLATFORM, CLEAR_SEND_TIME);
    expect(result).toEqual({ allowed: false, reason: 'QUIET_HOURS' });
  });
});
