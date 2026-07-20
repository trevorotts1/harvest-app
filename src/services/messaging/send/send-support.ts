// T-37 — shared plumbing for BOTH SMS send paths: the narrow, DI-mockable Prisma surface they read/
// write, the fail-closed crypto seams (phone decrypt for the recipient, body encrypt at rest), and
// the small recording helpers (find-or-create thread, record a sent/handed-off Message, record a
// held send). Kept separate from the two service files so "how a send is recorded" has exactly one
// implementation, and so the services themselves stay a readable sequence of gate → gate → send.
//
// Crypto is DI (`decryptPhone` / `encryptBody`) defaulting to the real T-22 Vault primitives, which
// read CONTACT_ENCRYPTION_KEY lazily, by name, at call time (never at module scope) and fail closed
// if absent — so a key-less build never touches the key, and tests inject deterministic stubs.

import { MessageChannel, MessageDirection, MessageSource } from '@prisma/client';

import { decryptOptionalField, encryptRequiredField } from '../../warm-market/vault/vault-encryption';
import type { SendComplianceContact } from '../../compliance/send-gate/send-compliance-gate';
import type { SendDraftFields, SendHoldReason } from './send-decision';

/** Narrow contact shape the send paths read — never the full encrypted Prisma row. `phone` is the
 *  AES-256-GCM envelope (or null); `phone_hash` is the keyed HMAC for the opt-out lookup; `timezone`
 *  drives recipient-local quiet hours. */
export interface SendContactRow {
  id: string;
  user_id: string;
  phone: string | null;
  phone_hash: string | null;
  email_hash: string | null;
  timezone: string | null;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  direction: MessageDirection;
  source: MessageSource;
  channel: MessageChannel;
  body: string;
  sent_from: string | null;
  delivery_status: string;
  handoff_confirmed: boolean;
  created_at: Date;
}

/** The DI-mockable Prisma surface both send paths need — same hand-written-delegate convention as
 *  every other service in this codebase (ApprovalInboxPrismaClient, OnboardingGatePrismaClient, ...). */
export interface SendPrismaClient {
  draftMessage: {
    findFirst(args: { where: { id: string; user_id: string } }): Promise<SendDraftFields | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  contact: {
    findFirst(args: {
      where: { id: string; user_id: string };
      select: { id: true; user_id: true; phone: true; phone_hash: true; email_hash: true; timezone: true };
    }): Promise<SendContactRow | null>;
  };
  messageThread: {
    findFirst(args: {
      where: { user_id: string; contact_id: string; channel: MessageChannel };
    }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  message: {
    create(args: { data: Record<string, unknown> }): Promise<MessageRow>;
    findFirst(args: {
      where: { id: string; thread: { user_id: string } };
    }): Promise<(MessageRow & { thread_id: string }) | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MessageRow>;
  };
}

/** Decrypts the recipient's phone envelope to E.164 plaintext. Defaults to the real T-22 primitive
 *  (lazy key read); tests inject a stub. */
export type PhoneDecryptor = (encrypted: string | null) => string | null;
/** Encrypts the message body for at-rest storage (`Message.body` is "encrypted at rest", schema
 *  §3.3). Defaults to the real T-22 primitive; tests inject an identity so they can assert plaintext. */
export type BodyEncryptor = (plaintext: string) => string;

export const defaultPhoneDecryptor: PhoneDecryptor = (encrypted) => decryptOptionalField(encrypted);
export const defaultBodyEncryptor: BodyEncryptor = (plaintext) => encryptRequiredField(plaintext);

/** Adapt a stored contact row to the exact shape SendComplianceGate.evaluate needs. */
export function toComplianceContact(row: SendContactRow): SendComplianceContact {
  return {
    contactId: row.id,
    phoneHash: row.phone_hash,
    emailHash: row.email_hash,
    timezone: row.timezone,
  };
}

/** Find-or-create the per-contact thread for a channel and stamp its activity. */
export async function resolveThreadId(
  prisma: SendPrismaClient,
  userId: string,
  contactId: string,
  channel: MessageChannel,
  now: Date
): Promise<string> {
  const existing = await prisma.messageThread.findFirst({
    where: { user_id: userId, contact_id: contactId, channel },
  });
  if (existing) {
    await prisma.messageThread.update({ where: { id: existing.id }, data: { last_activity_at: now } });
    return existing.id;
  }
  const created = await prisma.messageThread.create({
    data: { user_id: userId, contact_id: contactId, channel, state: 'ACTIVE', last_activity_at: now },
  });
  return created.id;
}

export interface RecordMessageInput {
  threadId: string;
  channel: MessageChannel;
  source: MessageSource;
  /** 'rep_number' (composer handoff) | 'platform_number' (Twilio) — per §3.3 Message.sent_from. */
  sentFrom: 'rep_number' | 'platform_number';
  /** PLAINTEXT body; this helper encrypts it via `encryptBody` before persistence. */
  body: string;
  deliveryStatus: string;
  handoffConfirmed: boolean;
}

/** Record ONE outbound Message (the sent/handed-off event, §3.3). Body is encrypted at rest. */
export async function recordOutboundMessage(
  prisma: SendPrismaClient,
  encryptBody: BodyEncryptor,
  input: RecordMessageInput
): Promise<MessageRow> {
  return prisma.message.create({
    data: {
      thread_id: input.threadId,
      direction: MessageDirection.OUTBOUND,
      source: input.source,
      channel: input.channel,
      body: encryptBody(input.body),
      sent_from: input.sentFrom,
      delivery_status: input.deliveryStatus,
      handoff_confirmed: input.handoffConfirmed,
    },
  });
}

/** Record why a send was withheld (`DraftMessage.send_hold_reason`, T-37 migration). This is the
 *  honest "held for review — nothing was lost" evidence (§5.2); it never itself causes a send. */
export async function recordSendHold(
  prisma: SendPrismaClient,
  draftId: string,
  reason: SendHoldReason
): Promise<void> {
  await prisma.draftMessage.update({ where: { id: draftId }, data: { send_hold_reason: reason } });
}

/** Clear a prior hold marker once a send/handoff succeeds. */
export async function clearSendHold(prisma: SendPrismaClient, draftId: string): Promise<void> {
  await prisma.draftMessage.update({ where: { id: draftId }, data: { send_hold_reason: null } });
}
