// T-37 (WP05 §10.1 automated-cadence path; §2.3 critical path; §5.2 fail-closed; §10.9-1) — the
// AUTOMATED platform SMS send through the Harvest platform number (Twilio, A2P 10DLC). Unlike the
// first-touch composer handoff, this path actually dispatches on the rep's behalf, so it is the
// most heavily gated surface in WP05. A message is sent ONLY when ALL THREE gates pass, IN ORDER:
//
//   (a) CFE-cleared  — the draft carries a RELEASED CFE verdict AND is human-approved AND unedited
//                      (resolveDraftClearance; consumes WP04 state, never re-runs the CFE / §5).
//   (b) SendComplianceGate.evaluate(SMS_PLATFORM) allowed — opt-out + recipient quiet hours + TCPA
//                      per-contact consent (T-38; deny-by-default).
//   (c) isChannelDeliverable(SMS_PLATFORM, org) deliverable — A2P brand+campaign APPROVED and a
//                      platform number assigned (T-36; fail-closed / SC5 launch gate).
//
// Each gate is LOAD-BEARING: neutering any one lets content leak that the other two would have
// stopped, and the T-37 test suite proves exactly that. Only after all three does it call the
// (DI-mockable) Twilio messaging client. ANY gate fail → HELD (no send), recorded on
// `DraftMessage.send_hold_reason`. Missing TWILIO_* keys → the client factory returns null → HELD
// (TWILIO_UNCONFIGURED): no send, no crash, no fabricated delivery (§0.4 build-safety).

import { MessageChannel, MessageSource } from '@prisma/client';

import { SendComplianceGate } from '../../compliance/send-gate/send-compliance-gate';
import type { ChannelDeliverabilityResult } from '../../deliverability/gate';
import { resolveDraftClearance, type SendHoldReason } from './send-decision';
import { toE164 } from './first-touch-composer.service';
import {
  createTwilioMessagingClient,
  type TwilioMessagingClient,
} from './twilio-messaging-client';
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

/** The T-36 deliverability seam this path consumes, narrowed to the one channel it sends on. The
 *  route wires the default: `(channel, orgId) => isChannelDeliverable(realDeps, channel, orgId)` —
 *  so this service CONSUMES `isChannelDeliverable` rather than reimplementing A2P readiness. */
export type DeliverabilityCheck = (
  channel: 'SMS_PLATFORM',
  organizationId: string
) => Promise<ChannelDeliverabilityResult>;

export interface PlatformSmsSendDeps {
  /** T-36 seam (required — forces every construction to explicitly wire `isChannelDeliverable`). */
  checkDeliverable: DeliverabilityCheck;
  /** T-38 gate; defaults to the real one (shared-prisma-backed sub-services). */
  sendGate?: SendComplianceGate;
  /** Lazy, by-name Twilio credential read; defaults to `createTwilioMessagingClient` (null when
   *  TWILIO_* is unset → fail-safe HELD). */
  twilioClientFactory?: () => TwilioMessagingClient | null;
  decryptPhone?: PhoneDecryptor;
  encryptBody?: BodyEncryptor;
}

export type PlatformSendResult =
  | { status: 'SENT'; messageId: string; providerSid: string; deliveryStatus: string }
  | { status: 'HELD'; reason: SendHoldReason }
  | { status: 'FAILED'; error: string }
  | { status: 'NOT_FOUND' };

export class PlatformSmsSendService {
  private readonly checkDeliverable: DeliverabilityCheck;
  private readonly sendGate: SendComplianceGate;
  private readonly twilioClientFactory: () => TwilioMessagingClient | null;
  private readonly decryptPhone: PhoneDecryptor;
  private readonly encryptBody: BodyEncryptor;

  constructor(private prisma: SendPrismaClient, deps: PlatformSmsSendDeps) {
    this.checkDeliverable = deps.checkDeliverable;
    this.sendGate = deps.sendGate ?? new SendComplianceGate();
    this.twilioClientFactory = deps.twilioClientFactory ?? createTwilioMessagingClient;
    this.decryptPhone = deps.decryptPhone ?? defaultPhoneDecryptor;
    this.encryptBody = deps.encryptBody ?? defaultBodyEncryptor;
  }

  /**
   * Attempt an automated platform send for a draft owned by `userId`. Ownership is enforced by
   * scoping every read to `(id, user_id)` — another rep's draft/contact is `NOT_FOUND`.
   */
  async send(
    userId: string,
    draftId: string,
    organizationId: string,
    now: Date = new Date()
  ): Promise<PlatformSendResult> {
    try {
      const draft = await this.prisma.draftMessage.findFirst({ where: { id: draftId, user_id: userId } });
      if (!draft) return { status: 'NOT_FOUND' };

      if (draft.channel !== MessageChannel.SMS_PLATFORM) {
        await recordSendHold(this.prisma, draftId, 'CHANNEL_MISMATCH');
        return { status: 'HELD', reason: 'CHANNEL_MISMATCH' };
      }

      // ── GATE (a): CFE-cleared + approved + unedited ──────────────────────────────────────────────
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

      // ── GATE (b): SendComplianceGate(SMS_PLATFORM) — opt-out + quiet hours + TCPA consent ────────
      const compliance = await this.sendGate.evaluate(toComplianceContact(contact), MessageChannel.SMS_PLATFORM, now);
      if (!compliance.allowed) {
        await recordSendHold(this.prisma, draftId, compliance.reason);
        return { status: 'HELD', reason: compliance.reason };
      }

      // ── GATE (c): isChannelDeliverable(SMS_PLATFORM) — A2P APPROVED + number assigned ────────────
      const deliverability = await this.checkDeliverable('SMS_PLATFORM', organizationId);
      if (!deliverability.deliverable) {
        await recordSendHold(this.prisma, draftId, 'NOT_DELIVERABLE');
        return { status: 'HELD', reason: 'NOT_DELIVERABLE' };
      }

      const fromNumber =
        typeof deliverability.detail.assignedPhoneNumber === 'string'
          ? (deliverability.detail.assignedPhoneNumber as string)
          : null;
      if (!fromNumber) {
        await recordSendHold(this.prisma, draftId, 'NO_PLATFORM_NUMBER');
        return { status: 'HELD', reason: 'NO_PLATFORM_NUMBER' };
      }

      // Twilio credentials — read lazily, by name; absent → fail-safe HELD (no send, no crash).
      const client = this.twilioClientFactory();
      if (!client) {
        await recordSendHold(this.prisma, draftId, 'TWILIO_UNCONFIGURED');
        return { status: 'HELD', reason: 'TWILIO_UNCONFIGURED' };
      }

      const plaintextPhone = this.decryptPhone(contact.phone);
      if (!plaintextPhone) {
        await recordSendHold(this.prisma, draftId, 'NO_PHONE');
        return { status: 'HELD', reason: 'NO_PHONE' };
      }

      // ── All three gates passed — the ONLY path that reaches an actual dispatch. ──────────────────
      // T-R19 fold-in: persist the compliance-evidence AuditEntry from the draft's already-computed
      // CFE verdict and link it on the recorded Message (no CFE re-run — key-less). T-R16 fold-in:
      // carry the draft's approval attribution onto the sent Message for the uiux §4.7 badge.
      const cfeAuditId = await linkCfeAuditForSend(this.prisma, draft, MessageChannel.SMS_PLATFORM);
      const threadId = await resolveThreadId(this.prisma, userId, contact.id, MessageChannel.SMS_PLATFORM, now);
      let sendResult;
      try {
        sendResult = await client.sendSms({ from: fromNumber, to: toE164(plaintextPhone), body: draft.body });
      } catch (err) {
        // A dispatch failure AFTER the gates passed is a delivery failure, not a gate hold — record
        // it as a FAILED message (uiux §5.7 "failed send stays in the timeline as failed") and leave
        // the approved draft retryable.
        await recordOutboundMessage(this.prisma, this.encryptBody, {
          threadId,
          channel: MessageChannel.SMS_PLATFORM,
          source: MessageSource.AGENT,
          sentFrom: 'platform_number',
          body: draft.body,
          deliveryStatus: 'FAILED',
          handoffConfirmed: false,
          cfeAuditId,
          approvedBy: draft.approved_by ?? null,
          approvedAt: draft.approved_at ?? null,
        });
        return { status: 'FAILED', error: (err as Error).message };
      }

      const message = await recordOutboundMessage(this.prisma, this.encryptBody, {
        threadId,
        channel: MessageChannel.SMS_PLATFORM,
        source: MessageSource.AGENT,
        sentFrom: 'platform_number',
        body: draft.body,
        deliveryStatus: sendResult.status,
        handoffConfirmed: false,
        cfeAuditId,
        approvedBy: draft.approved_by ?? null,
        approvedAt: draft.approved_at ?? null,
      });
      await clearSendHold(this.prisma, draftId);

      return {
        status: 'SENT',
        messageId: message.id,
        providerSid: sendResult.sid,
        deliveryStatus: sendResult.status,
      };
    } catch {
      await recordSendHold(this.prisma, draftId, 'ERROR').catch(() => undefined);
      return { status: 'HELD', reason: 'ERROR' };
    }
  }
}
