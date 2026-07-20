// T-39 (WP05 §10.5 email campaign builder / §10.7 email path; §2.3 critical path; §5.2 fail-closed;
// §10.9-6 CAN-SPAM) — the automated EMAIL send through the org's authenticated sending domain. The
// email analog of T-37's PlatformSmsSendService, and gated exactly the same way: a message is sent
// ONLY when ALL THREE gates pass, IN ORDER:
//
//   (a) CFE-cleared  — the draft carries a RELEASED CFE verdict AND is human-approved AND unedited
//                      (resolveDraftClearance; consumes WP04 state, never re-runs the CFE / §5).
//   (b) SendComplianceGate.evaluate(EMAIL) allowed — global opt-out + recipient quiet hours (T-38;
//                      EMAIL is not TCPA-consent-gated — that is SMS_PLATFORM only, see the gate).
//   (c) isChannelDeliverable('EMAIL', org, domain) deliverable — SPF/DKIM/DMARC all VERIFIED AND the
//                      sender warm-up active (T-36; fail-closed / SC5 launch gate). Requires the org's
//                      authenticated sending domain; no domain → HELD NO_SENDING_DOMAIN (fail-closed).
//
// Only after all three does it call the (DI-mockable) email client. Missing RESEND_API_KEY → the
// factory returns null → HELD (EMAIL_UNCONFIGURED): no send, no crash, no fabricated delivery (§0.4).
// The recorded Message links its compliance-evidence AuditEntry (cfe_audit_id) and carries approval
// attribution (T-R19/T-R16 fold-in), same as the SMS paths.

import { MessageChannel, MessageSource } from '@prisma/client';

import { SendComplianceGate } from '../../compliance/send-gate/send-compliance-gate';
import type { ChannelDeliverabilityResult } from '../../deliverability/gate';
import { resolveDraftClearance, type SendHoldReason } from './send-decision';
import {
  createEmailSendClient,
  resolveEmailFrom,
  type EmailSendClient,
} from './email-send-client';
import {
  clearSendHold,
  defaultBodyEncryptor,
  defaultEmailDecryptor,
  linkCfeAuditForSend,
  recordOutboundMessage,
  recordSendHold,
  resolveThreadId,
  toComplianceContact,
  type BodyEncryptor,
  type EmailDecryptor,
  type SendPrismaClient,
} from './send-support';

/** T-36 deliverability seam narrowed to EMAIL (requires the authenticated `domain`). The route wires
 *  `(channel, orgId, domain) => isChannelDeliverable({ a2pService, emailService }, channel, orgId, domain)`. */
export type EmailDeliverabilityCheck = (
  channel: 'EMAIL',
  organizationId: string,
  domain: string
) => Promise<ChannelDeliverabilityResult>;

/** CAN-SPAM identity the footer of every email carries (§10.5): a physical postal address and the
 *  base URL an unsubscribe link is built from. Deliberately injected (org config in production; a
 *  stub in tests) rather than hard-coded. */
export interface EmailSenderIdentity {
  physicalAddress: string;
  unsubscribeBaseUrl: string;
}

const DEFAULT_SENDER_IDENTITY: EmailSenderIdentity = {
  physicalAddress: 'The Harvest, 1 Community Way, Suite 100, Anytown, USA',
  unsubscribeBaseUrl: 'https://app.theharvest.example/unsubscribe',
};

/** A neutral, doctrine-clean default subject (no hype, no earnings claim, no "offer"/"opportunity").
 *  The route may override it per send. */
const DEFAULT_SUBJECT = 'A note from your community';

export interface EmailSendDeps {
  /** T-36 seam (required — forces every construction to explicitly wire `isChannelDeliverable`). */
  checkDeliverable: EmailDeliverabilityCheck;
  sendGate?: SendComplianceGate;
  /** Lazy, by-name RESEND_API_KEY read; defaults to `createEmailSendClient` (null when unset → HELD). */
  emailClientFactory?: () => EmailSendClient | null;
  decryptEmail?: EmailDecryptor;
  encryptBody?: BodyEncryptor;
  senderIdentity?: EmailSenderIdentity;
}

export type EmailSendResultOut =
  | { status: 'SENT'; messageId: string; providerId: string; deliveryStatus: string }
  | { status: 'HELD'; reason: SendHoldReason }
  | { status: 'FAILED'; error: string }
  | { status: 'NOT_FOUND' };

export class EmailSendService {
  private readonly checkDeliverable: EmailDeliverabilityCheck;
  private readonly sendGate: SendComplianceGate;
  private readonly emailClientFactory: () => EmailSendClient | null;
  private readonly decryptEmail: EmailDecryptor;
  private readonly encryptBody: BodyEncryptor;
  private readonly senderIdentity: EmailSenderIdentity;

  constructor(private prisma: SendPrismaClient, deps: EmailSendDeps) {
    this.checkDeliverable = deps.checkDeliverable;
    this.sendGate = deps.sendGate ?? new SendComplianceGate();
    this.emailClientFactory = deps.emailClientFactory ?? createEmailSendClient;
    this.decryptEmail = deps.decryptEmail ?? defaultEmailDecryptor;
    this.encryptBody = deps.encryptBody ?? defaultBodyEncryptor;
    this.senderIdentity = deps.senderIdentity ?? DEFAULT_SENDER_IDENTITY;
  }

  /**
   * Attempt an automated email send for a draft owned by `userId`. Ownership is enforced by scoping
   * every read to `(id, user_id)` — another rep's draft/contact is `NOT_FOUND`.
   */
  async send(
    userId: string,
    draftId: string,
    organizationId: string,
    sendingDomain: string | null,
    subject: string = DEFAULT_SUBJECT,
    now: Date = new Date()
  ): Promise<EmailSendResultOut> {
    try {
      const draft = await this.prisma.draftMessage.findFirst({ where: { id: draftId, user_id: userId } });
      if (!draft) return { status: 'NOT_FOUND' };

      if (draft.channel !== MessageChannel.EMAIL) {
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
        select: { id: true, user_id: true, phone: true, phone_hash: true, email_hash: true, timezone: true, email: true },
      });
      if (!contact) return { status: 'NOT_FOUND' };

      // ── GATE (b): SendComplianceGate(EMAIL) — opt-out + recipient quiet hours ────────────────────
      const compliance = await this.sendGate.evaluate(toComplianceContact(contact), MessageChannel.EMAIL, now);
      if (!compliance.allowed) {
        await recordSendHold(this.prisma, draftId, compliance.reason);
        return { status: 'HELD', reason: compliance.reason };
      }

      // The authenticated sending domain is required both to run the deliverability check and to
      // resolve the From address — no domain, no send (fail-closed, never a guessed sender).
      if (!sendingDomain) {
        await recordSendHold(this.prisma, draftId, 'NO_SENDING_DOMAIN');
        return { status: 'HELD', reason: 'NO_SENDING_DOMAIN' };
      }

      // ── GATE (c): isChannelDeliverable(EMAIL) — SPF/DKIM/DMARC VERIFIED + warm-up active ─────────
      const deliverability = await this.checkDeliverable('EMAIL', organizationId, sendingDomain);
      if (!deliverability.deliverable) {
        await recordSendHold(this.prisma, draftId, 'NOT_DELIVERABLE');
        return { status: 'HELD', reason: 'NOT_DELIVERABLE' };
      }

      // Provider credential — read lazily, by name; absent → fail-safe HELD (no send, no crash).
      const client = this.emailClientFactory();
      if (!client) {
        await recordSendHold(this.prisma, draftId, 'EMAIL_UNCONFIGURED');
        return { status: 'HELD', reason: 'EMAIL_UNCONFIGURED' };
      }

      const plaintextEmail = this.decryptEmail(contact.email ?? null);
      if (!plaintextEmail) {
        await recordSendHold(this.prisma, draftId, 'NO_EMAIL');
        return { status: 'HELD', reason: 'NO_EMAIL' };
      }

      // ── All three gates passed — the ONLY path that reaches an actual dispatch. ──────────────────
      const cfeAuditId = await linkCfeAuditForSend(this.prisma, draft, MessageChannel.EMAIL);
      const threadId = await resolveThreadId(this.prisma, userId, contact.id, MessageChannel.EMAIL, now);
      const from = resolveEmailFrom(sendingDomain);
      const unsubscribeUrl = `${this.senderIdentity.unsubscribeBaseUrl}?c=${encodeURIComponent(contact.email_hash ?? contact.id)}`;

      let sendResult;
      try {
        sendResult = await client.sendEmail({
          to: plaintextEmail,
          from,
          subject,
          body: draft.body,
          unsubscribeUrl,
          physicalAddress: this.senderIdentity.physicalAddress,
        });
      } catch (err) {
        await recordOutboundMessage(this.prisma, this.encryptBody, {
          threadId,
          channel: MessageChannel.EMAIL,
          source: MessageSource.AGENT,
          sentFrom: 'email_domain',
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
        channel: MessageChannel.EMAIL,
        source: MessageSource.AGENT,
        sentFrom: 'email_domain',
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
        providerId: sendResult.id,
        deliveryStatus: sendResult.status,
      };
    } catch {
      await recordSendHold(this.prisma, draftId, 'ERROR').catch(() => undefined);
      return { status: 'HELD', reason: 'ERROR' };
    }
  }
}
