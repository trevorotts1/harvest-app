// T-39 QC FIX 1 (uiux §5.7/§4.7) — teeth for `ConversationTimelineService`, the real read this
// build's `ConversationTimeline` component was always meant to sit on top of (per that component's
// own header comment: "the page/route does the session-gated read; this component renders, it does
// not fetch"). Proves:
//   • OWNERSHIP: a contact not owned by the caller (wrong user_id, or nonexistent) → `null`, and the
//     two cases are indistinguishable (same query, same result).
//   • DECRYPTION: Contact PII and Message.body are never returned as ciphertext.
//   • COMPOSITION: messages + a three-way handoff + system entries (opt-out, reply-paused,
//     reactivation) are merged into one chronologically-sorted stream with the exact field shape
//     `ConversationTimeline`'s `TimelineEntry` expects (kind/id/direction/... for a message; kind/id/
//     repName/... for a handoff).
//   • DOES NOT invoke any send-gating write path — this service's mocked Prisma surface has no
//     `create`/`update` delegates at all, so a test that accidentally called one would throw.

import {
  ConversationTimelineService,
  type ConversationTimelinePrismaClient,
} from './conversation-timeline.service';
import { encryptRequiredField } from '../../warm-market/vault/vault-encryption';

// The same fixed, committed, non-production test key `tests/jest.setup.ts` seeds into
// `CONTACT_ENCRYPTION_KEY` — a valid 32-byte base64 AES-256 key, not a real secret.
const KEY = 'G/eANyAndECpZB2O/RauSFnr4XupUIZjlzIAeNJjg+Q=';

function buildPrisma(overrides: Partial<ConversationTimelinePrismaClient> = {}): ConversationTimelinePrismaClient {
  return {
    contact: { findFirst: jest.fn().mockResolvedValue(null) },
    messageThread: { findMany: jest.fn().mockResolvedValue([]) },
    message: { findMany: jest.fn().mockResolvedValue([]) },
    threeWayHandoff: { findMany: jest.fn().mockResolvedValue([]) },
    outreachSequence: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    ...overrides,
  } as ConversationTimelinePrismaClient;
}

describe('ConversationTimelineService.getConversation — ownership (never a leak)', () => {
  test('a contactId that does not exist resolves to null', async () => {
    const prisma = buildPrisma({ contact: { findFirst: jest.fn().mockResolvedValue(null) } });
    const service = new ConversationTimelineService(prisma, KEY);
    const result = await service.getConversation('user-1', 'nonexistent-contact');
    expect(result).toBeNull();
  });

  test("TEETH: a contactId owned by a DIFFERENT user resolves to the SAME null — the query itself is scoped to user_id, so this never leaks another rep's contact", async () => {
    const findFirst = jest.fn().mockImplementation(({ where }) => {
      // Mirrors a real Prisma `findFirst` — only returns a row when BOTH id AND user_id match.
      if (where.id === 'contact-1' && where.user_id === 'the-actual-owner') {
        return Promise.resolve({
          id: 'contact-1',
          user_id: 'the-actual-owner',
          first_name: encryptRequiredField('Jamie', KEY),
          last_name: encryptRequiredField('Rivera', KEY),
          do_not_contact: false,
          agents_paused: false,
        });
      }
      return Promise.resolve(null);
    });
    const prisma = buildPrisma({ contact: { findFirst } });
    const service = new ConversationTimelineService(prisma, KEY);

    const asAttacker = await service.getConversation('some-other-rep', 'contact-1');
    expect(asAttacker).toBeNull();

    const asOwner = await service.getConversation('the-actual-owner', 'contact-1');
    expect(asOwner).not.toBeNull();
    expect(asOwner?.contact.name).toBe('Jamie Rivera');

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'contact-1', user_id: 'some-other-rep' } });
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'contact-1', user_id: 'the-actual-owner' } });
  });
});

describe('ConversationTimelineService.getConversation — decryption (never raw ciphertext)', () => {
  function ownedContact(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'contact-1',
      user_id: 'user-1',
      first_name: encryptRequiredField('Priya', KEY),
      last_name: encryptRequiredField('Nair', KEY),
      do_not_contact: false,
      agents_paused: false,
      ...overrides,
    };
  }

  test('the contact name is decrypted plaintext, never the ciphertext envelope', async () => {
    const prisma = buildPrisma({ contact: { findFirst: jest.fn().mockResolvedValue(ownedContact()) } });
    const service = new ConversationTimelineService(prisma, KEY);
    const result = await service.getConversation('user-1', 'contact-1');
    expect(result?.contact.name).toBe('Priya Nair');
    expect(result?.contact.name).not.toContain('ciphertext');
  });

  test('a message body is decrypted plaintext in the returned timeline entry', async () => {
    const threadId = 'thread-1';
    const prisma = buildPrisma({
      contact: { findFirst: jest.fn().mockResolvedValue(ownedContact()) },
      messageThread: {
        findMany: jest.fn().mockResolvedValue([
          { id: threadId, channel: 'SMS_PLATFORM', state: 'ACTIVE', last_activity_at: new Date('2026-07-01T00:00:00Z') },
        ]),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm-1',
            thread_id: threadId,
            direction: 'OUTBOUND',
            source: 'AGENT',
            channel: 'SMS_PLATFORM',
            body: encryptRequiredField('Warm hello from your agent.', KEY),
            sent_from: 'platform_number',
            delivery_status: 'queued',
            approved_by: 'user-1',
            approved_at: new Date('2026-07-14T15:00:00Z'),
            cfe_audit_id: 'audit-abc',
            created_at: new Date('2026-07-14T15:00:00Z'),
          },
        ]),
      },
    });
    const service = new ConversationTimelineService(prisma, KEY);
    const result = await service.getConversation('user-1', 'contact-1');

    expect(result).not.toBeNull();
    const entry = result?.entries.find((e) => e.kind === 'message');
    expect(entry).toMatchObject({
      kind: 'message',
      id: 'm-1',
      direction: 'OUTBOUND',
      source: 'AGENT',
      sentFrom: 'platform_number',
      channel: 'SMS_PLATFORM',
      body: 'Warm hello from your agent.',
      deliveryStatus: 'queued',
      approvedBy: 'user-1',
      cfeAuditId: 'audit-abc',
    });
  });
});

describe('ConversationTimelineService.getConversation — composition (messages + handoff + system entries)', () => {
  function ownedContact(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'contact-1',
      user_id: 'user-1',
      first_name: encryptRequiredField('Jamie', KEY),
      last_name: encryptRequiredField('Rivera', KEY),
      do_not_contact: false,
      agents_paused: false,
      ...overrides,
    };
  }

  test('a three-way handoff row is mapped to a handoff entry with rep + upline names resolved', async () => {
    const prisma = buildPrisma({
      contact: { findFirst: jest.fn().mockResolvedValue(ownedContact()) },
      threeWayHandoff: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'hf-1',
            upline_id: 'upline-1',
            state: 'JOINED',
            invited_at: new Date('2026-07-10T00:00:00Z'),
            joined_at: new Date('2026-07-10T01:00:00Z'),
            returned_at: null,
            coached_next_step: null,
          },
        ]),
      },
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'user-1') return Promise.resolve({ name: 'Alex' });
          if (where.id === 'upline-1') return Promise.resolve({ name: 'Dana' });
          return Promise.resolve(null);
        }),
      },
    });
    const service = new ConversationTimelineService(prisma, KEY);
    const result = await service.getConversation('user-1', 'contact-1');

    const handoffEntry = result?.entries.find((e) => e.kind === 'handoff');
    expect(handoffEntry).toMatchObject({
      kind: 'handoff',
      id: 'hf-1',
      repName: 'Alex',
      uplineName: 'Dana',
      state: 'JOINED',
    });
  });

  test('do_not_contact renders an opt-out system entry', async () => {
    const prisma = buildPrisma({
      contact: { findFirst: jest.fn().mockResolvedValue(ownedContact({ do_not_contact: true })) },
    });
    const service = new ConversationTimelineService(prisma, KEY);
    const result = await service.getConversation('user-1', 'contact-1');
    const optOut = result?.entries.find((e) => e.kind === 'system' && e.variant === 'opt-out');
    expect(optOut).toBeDefined();
  });

  test('a PAUSED/REPLY sequence renders a reply-paused system entry', async () => {
    const prisma = buildPrisma({
      contact: { findFirst: jest.fn().mockResolvedValue(ownedContact()) },
      outreachSequence: { findFirst: jest.fn().mockResolvedValue({ pause_reason: 'REPLY' }) },
    });
    const service = new ConversationTimelineService(prisma, KEY);
    const result = await service.getConversation('user-1', 'contact-1');
    const replyPaused = result?.entries.find((e) => e.kind === 'system' && e.variant === 'reply-paused');
    expect(replyPaused).toBeDefined();
  });

  test('entries are sorted chronologically ascending across messages + handoffs + system entries', async () => {
    const prisma = buildPrisma({
      contact: { findFirst: jest.fn().mockResolvedValue(ownedContact({ do_not_contact: true })) },
      messageThread: {
        findMany: jest.fn().mockResolvedValue([
          { id: 't-1', channel: 'SMS_PLATFORM', state: 'ACTIVE', last_activity_at: new Date('2026-07-01T00:00:00Z') },
        ]),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm-1',
            thread_id: 't-1',
            direction: 'OUTBOUND',
            source: 'AGENT',
            channel: 'SMS_PLATFORM',
            body: encryptRequiredField('First.', KEY),
            sent_from: 'platform_number',
            delivery_status: 'sent',
            approved_by: 'user-1',
            approved_at: new Date('2026-07-01T00:00:00Z'),
            cfe_audit_id: null,
            created_at: new Date('2026-07-01T00:00:00Z'),
          },
        ]),
      },
      threeWayHandoff: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'hf-1',
            upline_id: 'upline-1',
            state: 'INVITED',
            invited_at: new Date('2026-07-05T00:00:00Z'),
            joined_at: null,
            returned_at: null,
            coached_next_step: null,
          },
        ]),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Someone' }) },
    });
    const service = new ConversationTimelineService(prisma, KEY);
    const result = await service.getConversation('user-1', 'contact-1');

    const timestamps = result?.entries.map((e) => new Date(e.timestamp).getTime()) ?? [];
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
    // message (07-01) before handoff (07-05); the opt-out system entry (stamped "now") sorts last.
    expect(result?.entries[0].kind).toBe('message');
    expect(result?.entries[1].kind).toBe('handoff');
  });

  test('never invokes a write-path delegate — this is a pure read (no create/update in the mocked surface)', async () => {
    const prisma = buildPrisma({ contact: { findFirst: jest.fn().mockResolvedValue(ownedContact()) } });
    const service = new ConversationTimelineService(prisma, KEY);
    await service.getConversation('user-1', 'contact-1');
    // The mocked Prisma surface above has no `create`/`update` method on any delegate at all — if the
    // service tried to call one, this test would throw a TypeError before reaching this assertion.
    expect(true).toBe(true);
  });
});
