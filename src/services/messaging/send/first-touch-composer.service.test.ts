// T-37 — first-touch composer handoff (master-spec §10.1; uiux §4.4). Proves: a CFE-cleared,
// approved draft produces the `sms:` handoff payload from the rep's OWN number; an OPTED-OUT contact
// is BLOCKED even on the first touch (SendComplianceGate is load-bearing); a non-released / non-
// approved draft never composes; ownership is enforced; the confirmation records handoff_confirmed.
// Runs KEY-LESS (the T-38 SendComplianceGate is exercised for real, with stubbed opt-out/consent).

import { CFEOutcome, MessageChannel } from '@prisma/client';

import { FirstTouchComposerService, toE164 } from './first-touch-composer.service';
import type { SendDraftFields } from './send-decision';
import type { SendContactRow, SendPrismaClient } from './send-support';
import { SendComplianceGate } from '../../compliance/send-gate/send-compliance-gate';
import type { OptOutRegistryService } from '../../compliance/opt-out/opt-out-registry';
import type { MessagingConsentLedger } from '../../compliance/messaging-consent/messaging-consent-ledger';
import {
  decryptRequiredField,
  encryptOptionalField,
} from '../../warm-market/vault/vault-encryption';

// A daytime instant in the recipient's zone (3 PM EDT) so quiet hours are NOT the thing under test.
const DAYTIME = new Date('2026-07-15T19:00:00Z');
const BODY = 'Hey Tasha — it has been too long, would love to catch up sometime soon.';

function makeGate(opts: { optedOut?: boolean; hasConsent?: boolean } = {}): SendComplianceGate {
  return new SendComplianceGate(
    { isOptedOut: async () => opts.optedOut ?? false } as unknown as OptOutRegistryService,
    { hasMessagingConsent: async () => opts.hasConsent ?? true } as unknown as MessagingConsentLedger
  );
}

function draftRow(overrides: Partial<SendDraftFields> = {}): SendDraftFields {
  return {
    id: 'd-1',
    user_id: 'rep-1',
    contact_id: 'c-1',
    channel: MessageChannel.SMS_HANDOFF,
    body: BODY,
    cfe_outcome: CFEOutcome.PASS,
    approval_state: 'APPROVED',
    edited_after_approval: false,
    ...overrides,
  };
}

function contactRow(overrides: Partial<SendContactRow> = {}): SendContactRow {
  return {
    id: 'c-1',
    user_id: 'rep-1',
    phone: 'ENVELOPE_PHONE',
    phone_hash: 'phone-hash-1',
    email_hash: null,
    timezone: 'America/New_York',
    ...overrides,
  };
}

interface Stores {
  drafts: Map<string, SendDraftFields & { send_hold_reason?: string | null }>;
  contacts: Map<string, SendContactRow>;
  threads: Array<{ id: string; user_id: string; contact_id: string; channel: MessageChannel }>;
  messages: Array<Record<string, unknown> & { id: string; thread_id: string }>;
}

function makePrisma(seed: { drafts?: SendDraftFields[]; contacts?: SendContactRow[] } = {}): {
  prisma: SendPrismaClient;
  stores: Stores;
} {
  const stores: Stores = {
    drafts: new Map((seed.drafts ?? [draftRow()]).map((d) => [d.id, { ...d }])),
    contacts: new Map((seed.contacts ?? [contactRow()]).map((c) => [c.id, { ...c }])),
    threads: [],
    messages: [],
  };
  let threadN = 0;
  let msgN = 0;
  const prisma = {
    draftMessage: {
      findFirst: async ({ where }: { where: { id: string; user_id: string } }) => {
        const d = stores.drafts.get(where.id);
        return d && d.user_id === where.user_id ? { ...d } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const d = stores.drafts.get(where.id)!;
        Object.assign(d, data);
        return { ...d };
      },
    },
    contact: {
      findFirst: async ({ where }: { where: { id: string; user_id: string } }) => {
        const c = stores.contacts.get(where.id);
        return c && c.user_id === where.user_id ? { ...c } : null;
      },
    },
    messageThread: {
      findFirst: async ({ where }: { where: { user_id: string; contact_id: string; channel: MessageChannel } }) =>
        stores.threads.find(
          (t) => t.user_id === where.user_id && t.contact_id === where.contact_id && t.channel === where.channel
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const t = { id: `thread-${++threadN}`, ...(data as object) } as Stores['threads'][number];
        stores.threads.push(t);
        return { id: t.id };
      },
      update: async () => ({}),
    },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const m = { id: `msg-${++msgN}`, created_at: new Date(), ...data } as unknown as Stores['messages'][number];
        stores.messages.push(m);
        return m;
      },
      findFirst: async ({ where }: { where: { id: string; thread: { user_id: string } } }) => {
        const m = stores.messages.find((x) => x.id === where.id);
        if (!m) return null;
        const t = stores.threads.find((x) => x.id === m.thread_id);
        return t && t.user_id === where.thread.user_id ? { ...m } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const m = stores.messages.find((x) => x.id === where.id)!;
        Object.assign(m, data);
        return m;
      },
    },
  } as unknown as SendPrismaClient;
  return { prisma, stores };
}

describe('toE164', () => {
  test('passes through an existing +E.164', () => expect(toE164('+15551234567')).toBe('+15551234567'));
  test('assumes US for a bare 10-digit number', () => expect(toE164('(555) 123-4567')).toBe('+15551234567'));
  test('handles an 11-digit 1-prefixed number', () => expect(toE164('1-555-123-4567')).toBe('+15551234567'));
});

describe('FirstTouchComposerService.prepareHandoff', () => {
  test('CFE-cleared + approved draft => the rep-own-number composer handoff payload + recorded event', async () => {
    const { prisma, stores } = makePrisma();
    const service = new FirstTouchComposerService(prisma, makeGate(), {
      decryptPhone: () => '+15551234567',
      encryptBody: (s) => s,
    });

    const result = await service.prepareHandoff('rep-1', 'd-1', DAYTIME);

    expect(result.status).toBe('READY');
    if (result.status !== 'READY') return;
    expect(result.payload).toEqual({
      channel: 'FIRST_TOUCH_COMPOSER',
      to: '+15551234567',
      body: BODY,
      smsUri: `sms:+15551234567?body=${encodeURIComponent(BODY)}`,
      clearedAt: DAYTIME.toISOString(),
      repOwnNumber: true,
    });
    // Event recorded as compliance evidence — from the REP's number, honestly "handed off" (not a
    // fake delivery), unconfirmed until the rep taps "I sent it".
    expect(stores.messages).toHaveLength(1);
    expect(stores.messages[0]).toMatchObject({
      channel: MessageChannel.SMS_HANDOFF,
      sent_from: 'rep_number',
      delivery_status: 'HANDED_OFF',
      handoff_confirmed: false,
      body: BODY,
    });
    expect(stores.drafts.get('d-1')!.send_hold_reason).toBeNull();
  });

  test('TEETH: an OPTED-OUT contact is BLOCKED even on the first touch — no payload, no send', async () => {
    const { prisma, stores } = makePrisma();
    const service = new FirstTouchComposerService(prisma, makeGate({ optedOut: true }), {
      decryptPhone: () => '+15551234567',
      encryptBody: (s) => s,
    });

    const result = await service.prepareHandoff('rep-1', 'd-1', DAYTIME);

    expect(result).toEqual({ status: 'HELD', reason: 'OPTED_OUT' });
    expect(stores.messages).toHaveLength(0); // nothing composed/recorded — the gate call is load-bearing
    expect(stores.drafts.get('d-1')!.send_hold_reason).toBe('OPTED_OUT');
  });

  test('quiet hours (unknown recipient timezone => fail-closed) blocks the handoff', async () => {
    const { prisma, stores } = makePrisma({ contacts: [contactRow({ timezone: null })] });
    const service = new FirstTouchComposerService(prisma, makeGate(), {
      decryptPhone: () => '+15551234567',
      encryptBody: (s) => s,
    });
    const result = await service.prepareHandoff('rep-1', 'd-1', DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'QUIET_HOURS' });
    expect(stores.messages).toHaveLength(0);
  });

  test('a non-released (BLOCK) draft never composes', async () => {
    const { prisma, stores } = makePrisma({ drafts: [draftRow({ cfe_outcome: CFEOutcome.BLOCK })] });
    const service = new FirstTouchComposerService(prisma, makeGate(), { decryptPhone: () => '+15551234567' });
    const result = await service.prepareHandoff('rep-1', 'd-1', DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_CFE_CLEARED' });
    expect(stores.messages).toHaveLength(0);
  });

  test('an un-approved (PENDING) draft never composes', async () => {
    const { prisma } = makePrisma({ drafts: [draftRow({ approval_state: 'PENDING' })] });
    const service = new FirstTouchComposerService(prisma, makeGate(), { decryptPhone: () => '+15551234567' });
    const result = await service.prepareHandoff('rep-1', 'd-1', DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_APPROVED' });
  });

  test('a SMS_PLATFORM draft cannot be routed through the composer handoff', async () => {
    const { prisma } = makePrisma({ drafts: [draftRow({ channel: MessageChannel.SMS_PLATFORM })] });
    const service = new FirstTouchComposerService(prisma, makeGate(), { decryptPhone: () => '+15551234567' });
    const result = await service.prepareHandoff('rep-1', 'd-1', DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'CHANNEL_MISMATCH' });
  });

  test('no phone on file (post-gate) => held NO_PHONE', async () => {
    const { prisma } = makePrisma();
    const service = new FirstTouchComposerService(prisma, makeGate(), { decryptPhone: () => null });
    const result = await service.prepareHandoff('rep-1', 'd-1', DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NO_PHONE' });
  });

  test('OWNERSHIP: another rep cannot compose to this draft (NOT_FOUND, not a leak)', async () => {
    const { prisma, stores } = makePrisma();
    const service = new FirstTouchComposerService(prisma, makeGate(), { decryptPhone: () => '+15551234567' });
    const result = await service.prepareHandoff('rep-999', 'd-1', DAYTIME);
    expect(result).toEqual({ status: 'NOT_FOUND' });
    expect(stores.messages).toHaveLength(0);
  });

  test('OWNERSHIP: a draft whose contact belongs to another rep => NOT_FOUND', async () => {
    const { prisma } = makePrisma({ contacts: [contactRow({ user_id: 'someone-else' })] });
    const service = new FirstTouchComposerService(prisma, makeGate(), { decryptPhone: () => '+15551234567' });
    const result = await service.prepareHandoff('rep-1', 'd-1', DAYTIME);
    expect(result).toEqual({ status: 'NOT_FOUND' });
  });

  test('KEY-LESS real crypto round-trip: default decryptor/encryptor use the seeded test key', async () => {
    // Encrypt a real phone envelope with the T-22 Vault primitive (test key seeded by jest.setup).
    const { prisma, stores } = makePrisma({ contacts: [contactRow({ phone: encryptOptionalField('+15557778888') })] });
    const service = new FirstTouchComposerService(prisma, makeGate()); // no injected crypto — real path
    const result = await service.prepareHandoff('rep-1', 'd-1', DAYTIME);
    expect(result.status).toBe('READY');
    if (result.status !== 'READY') return;
    expect(result.payload.to).toBe('+15557778888');
    // Message body is stored ENCRYPTED at rest (§3.3), and decrypts back to the cleared text.
    const stored = stores.messages[0].body as string;
    expect(stored).not.toBe(BODY);
    expect(decryptRequiredField(stored)).toBe(BODY);
  });
});

describe('FirstTouchComposerService.confirmHandoff', () => {
  async function prepared() {
    const { prisma, stores } = makePrisma();
    const service = new FirstTouchComposerService(prisma, makeGate(), {
      decryptPhone: () => '+15551234567',
      encryptBody: (s) => s,
    });
    const res = await service.prepareHandoff('rep-1', 'd-1', DAYTIME);
    if (res.status !== 'READY') throw new Error('setup failed');
    return { service, stores, messageId: res.messageId };
  }

  test('"I sent it" records handoff_confirmed', async () => {
    const { service, stores, messageId } = await prepared();
    const res = await service.confirmHandoff('rep-1', messageId, true);
    expect(res).toEqual({ status: 'CONFIRMED', messageId });
    expect(stores.messages[0].handoff_confirmed).toBe(true);
  });

  test('"I didn\'t send it" marks not-sent (returns to the queue)', async () => {
    const { service, stores, messageId } = await prepared();
    const res = await service.confirmHandoff('rep-1', messageId, false);
    expect(res).toEqual({ status: 'MARKED_NOT_SENT', messageId });
    expect(stores.messages[0].delivery_status).toBe('NOT_SENT');
  });

  test('OWNERSHIP: another rep cannot confirm this handoff', async () => {
    const { service, messageId } = await prepared();
    const res = await service.confirmHandoff('rep-999', messageId, true);
    expect(res).toEqual({ status: 'NOT_FOUND' });
  });
});
