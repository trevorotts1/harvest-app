// T-37 — shared plumbing for BOTH SMS send paths: the narrow, DI-mockable Prisma surface they read/
// write, the fail-closed crypto seams (phone decrypt for the recipient, body encrypt at rest), and
// the small recording helpers (find-or-create thread, record a sent/handed-off Message, record a
// held send). Kept separate from the two service files so "how a send is recorded" has exactly one
// implementation, and so the services themselves stay a readable sequence of gate → gate → send.
//
// Crypto is DI (`decryptPhone` / `encryptBody`) defaulting to the real T-22 Vault primitives, which
// read CONTACT_ENCRYPTION_KEY lazily, by name, at call time (never at module scope) and fail closed
// if absent — so a key-less build never touches the key, and tests inject deterministic stubs.

import { MessageChannel, MessageDirection, MessageSource, Role } from '@prisma/client';

import { decryptOptionalField, encryptRequiredField } from '../../warm-market/vault/vault-encryption';
import type { SendComplianceContact } from '../../compliance/send-gate/send-compliance-gate';
import {
  AuditService,
  PrismaAuditRepository,
  type AuditEntryPrismaDelegate,
} from '../../compliance/audit/audit-service';
import { CFE_RULE_VERSION } from '../../../types/compliance';
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
  /** T-39 (§10.7 email path): the AES-256-GCM email envelope, decrypted to a plaintext address only
   *  at the email dispatch boundary. Optional so the SMS paths' fixtures (which never read it) and
   *  pre-T-39 mocks still satisfy this shape. */
  email?: string | null;
  /** T-R40: optional so every pre-existing fixture/mock (which never read pipeline state) stays
   *  structurally valid. Present on the row `PipelineService.advanceStage` reads via
   *  `contact.findUnique` on this same client. */
  pipeline_stage?: string;
  do_not_contact?: boolean;
  last_contact_date?: Date | null;
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
      select: {
        id: true;
        user_id: true;
        phone: true;
        phone_hash: true;
        email_hash: true;
        timezone: true;
        email?: true;
      };
    }): Promise<SendContactRow | null>;
    // T-R40: pipeline-advancement read/write. `PipelineService` calls these two on this SAME
    // (narrowly-typed) client — cast to the full `PrismaClient` at the call site — so a real
    // Contact row's `pipeline_stage`/`do_not_contact` are read and written through the real Prisma
    // methods in production, and through a test double's own `findUnique`/`update` in tests.
    findUnique?(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
    update?(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
  /** T-39 (T-R19 fold-in): OPTIONAL — the append-only AuditEntry delegate `linkCfeAuditForSend` uses
   *  to persist the durable compliance-evidence record `Message.cfe_audit_id` points at. Absent in
   *  the SMS paths' pre-existing fixtures → the link resolves best-effort to null (never a crash,
   *  never a blocked send); present (real Prisma, or a test's in-memory store) → the link is written. */
  auditEntry?: AuditEntryPrismaDelegate;
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
      // T-R40: optionally join the thread so a caller (confirmHandoff) can resolve which Contact
      // this message belongs to without a second round trip.
      include?: { thread: true };
    }): Promise<(MessageRow & { thread_id: string; thread?: { id: string; contact_id: string; user_id: string } }) | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MessageRow>;
  };
}

/** Decrypts the recipient's phone envelope to E.164 plaintext. Defaults to the real T-22 primitive
 *  (lazy key read); tests inject a stub. */
export type PhoneDecryptor = (encrypted: string | null) => string | null;
/** Encrypts the message body for at-rest storage (`Message.body` is "encrypted at rest", schema
 *  §3.3). Defaults to the real T-22 primitive; tests inject an identity so they can assert plaintext. */
export type BodyEncryptor = (plaintext: string) => string;

/** Decrypts the recipient's email envelope to a plaintext address (email path only). Same T-22
 *  primitive as the phone decryptor; a separate name keeps the two dispatch boundaries self-documenting. */
export type EmailDecryptor = (encrypted: string | null) => string | null;

export const defaultPhoneDecryptor: PhoneDecryptor = (encrypted) => decryptOptionalField(encrypted);
export const defaultEmailDecryptor: EmailDecryptor = (encrypted) => decryptOptionalField(encrypted);
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
  /** 'rep_number' (composer handoff) | 'platform_number' (Twilio) | 'email_domain' (T-39 email) —
   *  per §3.3 Message.sent_from. */
  sentFrom: 'rep_number' | 'platform_number' | 'email_domain';
  /** PLAINTEXT body; this helper encrypts it via `encryptBody` before persistence. */
  body: string;
  deliveryStatus: string;
  handoffConfirmed: boolean;
  /** T-39 (T-R19 fold-in): the AuditEntry.id this send points at (compliance-evidence link). T-37
   *  left this null; every T-39 gated send now resolves it via `linkCfeAuditForSend`. */
  cfeAuditId?: string | null;
  /** T-39 (T-R16 fold-in): approval attribution carried from the DraftMessage so the uiux §4.7
   *  agent-sent badge ("approved by you [date]") reads off the immutable sent record. */
  approvedBy?: string | null;
  approvedAt?: Date | null;
}

/** Record ONE outbound Message (the sent/handed-off event, §3.3). Body is encrypted at rest. The
 *  T-R16/T-R19 fold-in fields (cfe_audit_id + approval attribution) are written when the caller
 *  resolved them; a caller that passes none leaves them null exactly as before (additive). */
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
      cfe_audit_id: input.cfeAuditId ?? null,
      approved_by: input.approvedBy ?? null,
      approved_at: input.approvedAt ?? null,
    },
  });
}

/**
 * T-39 (T-R19 fold-in; §2.3 "→ audit store"; §5.6/§5.7) — resolve the AuditEntry.id a sent Message
 * links to. T-37 left `Message.cfe_audit_id` null because WP04's draft/approval flow currently emits
 * CFE decisions to a Noop audit sink (nothing persisted). At the moment of send — the point §2.3
 * places the audit-store write — this persists ONE durable, hash-chained compliance-evidence
 * AuditEntry built from the draft's ALREADY-COMPUTED, persisted CFE verdict (`cfe_outcome` /
 * `cfe_risk_score` / `cfe_classifier_data`). It NEVER re-runs the CFE (that would need a live key and
 * break the key-less contract) — it records the verdict WP04 already reached, tagged to the draft via
 * `content_id`, so the send provably points at its compliance record.
 *
 * Best-effort by design: any failure (no auditEntry delegate in a fixture, a DB error) resolves to
 * `null` — the evidence link is not itself a send gate, so its absence must never block a
 * fully-gated, compliant send nor crash the path. Returns the new AuditEntry.id, or null.
 */
export async function linkCfeAuditForSend(
  prisma: SendPrismaClient,
  draft: Pick<SendDraftFields, 'id' | 'user_id' | 'body' | 'cfe_outcome' | 'cfe_risk_score' | 'cfe_classifier_data'>,
  channel: MessageChannel,
  auditService?: AuditService
): Promise<string | null> {
  try {
    if (!auditService && !prisma.auditEntry) return null;
    const service =
      auditService ??
      new AuditService(new PrismaAuditRepository(prisma as unknown as { auditEntry: AuditEntryPrismaDelegate }));
    return await service.recordAuditEvent({
      domain: 'cfe',
      user_id: draft.user_id,
      role: Role.REP,
      content_id: draft.id,
      content_text: draft.body,
      channel,
      risk_score: draft.cfe_risk_score ?? 0,
      // The draft carries the CFE's released verdict (PASS/FLAG); pass it through verbatim as the
      // audit outcome. A non-released draft never reaches here — the send decision HELDs it first.
      outcome: (draft.cfe_outcome ?? 'RECORDED') as 'PASS' | 'FLAG' | 'BLOCK' | 'RECORDED',
      event_data: {
        source: 'T39_SEND',
        dispatched_channel: channel,
        classifier_data: draft.cfe_classifier_data ?? null,
      },
      regulation: 'NONE',
      rule_version: CFE_RULE_VERSION,
    });
  } catch {
    return null;
  }
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
