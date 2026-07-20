// T-37 (WP05 §10.1 first-touch path; uiux §4.4 Composer Handoff Sheet / §5.7 AC-5.6-6) — the
// FIRST-TOUCH composer handoff: turn a CFE-cleared, human-approved draft into the one-tap
// `sms:{E.164}?body=…` deep link the native Messages composer opens, so the first message genuinely
// comes from the REP'S OWN number (a real blue bubble). This is NOT an automated send — the rep
// taps send in Messages; the app records the cleared text + handoff time as compliance evidence and
// later takes the rep's one-tap "I sent it" confirmation (`confirmHandoff`).
//
// The two honest asymmetries with the platform path (§10.1), both enforced here:
//   • NOT platform/A2P/deliverability-gated. The rep's own number is never Twilio-provisioned, so
//     `isChannelDeliverable(FIRST_TOUCH_COMPOSER, …)` is the documented exception that always
//     reports deliverable (see src/services/deliverability/gate.ts header) — there is nothing to
//     check, and this service deliberately does NOT call it. It is NOT gated on TCPA consent either
//     (SendComplianceGate excludes SMS_HANDOFF from TCPA — a human-confirmed send is not "automated
//     messaging").
//   • STILL subject to opt-out (and recipient quiet hours). An opted-out contact CANNOT even be
//     composed to: SendComplianceGate.evaluate(SMS_HANDOFF) is called before any payload is built,
//     and a block there means no deep link is produced and no message is recorded (deny-by-default).
//
// The app NEVER claims to have sent the message (uiux §4.4 honesty rule): the recorded Message is
// `sent_from = rep_number`, `delivery_status = HANDED_OFF`, `handoff_confirmed = false` until the
// rep confirms — never a fabricated "delivered".

import { MessageChannel, MessageSource } from '@prisma/client';

import { SendComplianceGate } from '../../compliance/send-gate/send-compliance-gate';
import { resolveDraftClearance, type SendHoldReason } from './send-decision';
import {
  clearSendHold,
  defaultBodyEncryptor,
  defaultPhoneDecryptor,
  linkCfeAuditForSend,
  recordOutboundMessage,
  recordSendHold,
  resolveThreadId,
  toComplianceContact,
  type BodyEncryptor,
  type PhoneDecryptor,
  type SendPrismaClient,
} from './send-support';

/** The one-tap handoff payload the native shell turns into an `sms:` intent. Carries NO from-number
 *  — the rep's own device number is the sender (the app cannot and does not set it); `repOwnNumber`
 *  is the honesty flag the UI renders ("sent from your number"). */
export interface ComposerHandoffPayload {
  /** The deliverability-lane channel name for this path (§10.1 exception) — never `SMS_PLATFORM`. */
  channel: 'FIRST_TOUCH_COMPOSER';
  /** Recipient in E.164. */
  to: string;
  /** The exact CFE-cleared, human-approved text, prefilled read-only in the composer. */
  body: string;
  /** `sms:{E.164}?body={url-encoded cleared text}` — the deep link the shell fires (uiux §4.4). */
  smsUri: string;
  /** Compliance evidence: when this text was cleared/handed off (ISO-8601). */
  clearedAt: string;
  /** Always true — the message goes out from the rep's own number, never a platform number. */
  repOwnNumber: true;
}

export type ComposerHandoffResult =
  | { status: 'READY'; payload: ComposerHandoffPayload; messageId: string }
  | { status: 'HELD'; reason: SendHoldReason }
  | { status: 'NOT_FOUND' };

export type ConfirmHandoffResult =
  | { status: 'CONFIRMED'; messageId: string }
  | { status: 'MARKED_NOT_SENT'; messageId: string }
  | { status: 'NOT_FOUND' };

/** Normalize a stored phone (digits, or already `+…`) to a best-effort E.164 for the `sms:` link.
 *  Conservative and deterministic: keeps an existing leading `+`; treats a bare 10-digit number as
 *  US (+1) and an 11-digit `1…` as US; otherwise prefixes `+` to the digits. */
export function toE164(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function buildSmsUri(e164: string, body: string): string {
  return `sms:${e164}?body=${encodeURIComponent(body)}`;
}

/**
 * The first-touch composer handoff service. Consumes the T-38 SendComplianceGate (opt-out + quiet
 * hours; NOT A2P, NOT TCPA — §10.1) and the WP04 draft state (CFE-cleared + approved); never
 * re-runs the CFE and never touches a Twilio credential (the rep's own device sends).
 */
export class FirstTouchComposerService {
  private readonly decryptPhone: PhoneDecryptor;
  private readonly encryptBody: BodyEncryptor;

  constructor(
    private prisma: SendPrismaClient,
    private sendGate: SendComplianceGate = new SendComplianceGate(),
    opts: { decryptPhone?: PhoneDecryptor; encryptBody?: BodyEncryptor } = {}
  ) {
    this.decryptPhone = opts.decryptPhone ?? defaultPhoneDecryptor;
    this.encryptBody = opts.encryptBody ?? defaultBodyEncryptor;
  }

  /**
   * Produce the composer handoff for a draft owned by `userId`. Ownership is enforced by scoping
   * every read to `(id, user_id)` — a draft/contact belonging to another rep is indistinguishable
   * from a nonexistent one (`NOT_FOUND`), never a leaky 403.
   */
  async prepareHandoff(userId: string, draftId: string, now: Date = new Date()): Promise<ComposerHandoffResult> {
    try {
      const draft = await this.prisma.draftMessage.findFirst({ where: { id: draftId, user_id: userId } });
      if (!draft) return { status: 'NOT_FOUND' };

      // The first touch is the SMS_HANDOFF channel; a platform-cadence draft must not be routed here.
      if (draft.channel !== MessageChannel.SMS_HANDOFF) {
        await recordSendHold(this.prisma, draftId, 'CHANNEL_MISMATCH');
        return { status: 'HELD', reason: 'CHANNEL_MISMATCH' };
      }

      // GATE 1 — CFE-cleared + human-approved + not-edited-since-approval (§2.3, §5.2, §18.1).
      const clearance = resolveDraftClearance(draft);
      if (!clearance.cleared) {
        await recordSendHold(this.prisma, draftId, clearance.reason);
        return { status: 'HELD', reason: clearance.reason };
      }

      const contact = await this.prisma.contact.findFirst({
        where: { id: draft.contact_id, user_id: userId },
        select: { id: true, user_id: true, phone: true, phone_hash: true, email_hash: true, timezone: true },
      });
      if (!contact) return { status: 'NOT_FOUND' };

      // GATE 2 — SendComplianceGate for the SMS_HANDOFF channel: opt-out + recipient quiet hours.
      // (Deny-by-default; a missing phone_hash makes this resolve ERROR, never "safe to send".)
      const compliance = await this.sendGate.evaluate(toComplianceContact(contact), MessageChannel.SMS_HANDOFF, now);
      if (!compliance.allowed) {
        await recordSendHold(this.prisma, draftId, compliance.reason);
        return { status: 'HELD', reason: compliance.reason };
      }

      // Recipient plaintext phone for the `sms:` link (the ONLY place plaintext is needed).
      const plaintextPhone = this.decryptPhone(contact.phone);
      if (!plaintextPhone) {
        await recordSendHold(this.prisma, draftId, 'NO_PHONE');
        return { status: 'HELD', reason: 'NO_PHONE' };
      }

      const e164 = toE164(plaintextPhone);
      const clearedAt = now.toISOString();
      const payload: ComposerHandoffPayload = {
        channel: 'FIRST_TOUCH_COMPOSER',
        to: e164,
        body: draft.body,
        smsUri: buildSmsUri(e164, draft.body),
        clearedAt,
        repOwnNumber: true,
      };

      // Record the handoff EVENT as compliance evidence: sent_from = rep_number, HANDED_OFF (honest,
      // never a fake delivery tick), handoff_confirmed = false until the rep taps "I sent it".
      // T-R19/T-R16 fold-in: link the compliance-evidence AuditEntry + carry approval attribution.
      const cfeAuditId = await linkCfeAuditForSend(this.prisma, draft, MessageChannel.SMS_HANDOFF);
      const threadId = await resolveThreadId(this.prisma, userId, contact.id, MessageChannel.SMS_HANDOFF, now);
      const message = await recordOutboundMessage(this.prisma, this.encryptBody, {
        threadId,
        channel: MessageChannel.SMS_HANDOFF,
        source: MessageSource.REP,
        sentFrom: 'rep_number',
        body: draft.body,
        deliveryStatus: 'HANDED_OFF',
        handoffConfirmed: false,
        cfeAuditId,
        approvedBy: draft.approved_by ?? null,
        approvedAt: draft.approved_at ?? null,
      });
      await clearSendHold(this.prisma, draftId);

      return { status: 'READY', payload, messageId: message.id };
    } catch {
      // Deny-by-default: any unexpected error holds — no deep link, no fabricated send.
      await recordSendHold(this.prisma, draftId, 'ERROR').catch(() => undefined);
      return { status: 'HELD', reason: 'ERROR' };
    }
  }

  /**
   * The one-tap "Did it send?" confirmation (uiux §4.4). `sent === true` → `handoff_confirmed`;
   * `sent === false` → mark not-sent (the item returns to the queue, no shame copy). Ownership is
   * enforced through the message's thread (`thread.user_id === userId`).
   */
  async confirmHandoff(userId: string, messageId: string, sent: boolean): Promise<ConfirmHandoffResult> {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, thread: { user_id: userId } },
    });
    if (!message) return { status: 'NOT_FOUND' };

    if (sent) {
      await this.prisma.message.update({ where: { id: messageId }, data: { handoff_confirmed: true } });
      return { status: 'CONFIRMED', messageId };
    }
    await this.prisma.message.update({
      where: { id: messageId },
      data: { handoff_confirmed: false, delivery_status: 'NOT_SENT' },
    });
    return { status: 'MARKED_NOT_SENT', messageId };
  }
}
