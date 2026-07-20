// T-37 (WP05 §10.1) — THE send seam. This is the single public surface the sequences/conversation
// unit (T-39) and any other caller import to dispatch on either SMS path, so no future code has to
// know which gates run or in what order:
//
//   • FirstTouchComposerService.prepareHandoff / confirmHandoff  → the rep's own-number blue bubble
//   • PlatformSmsSendService.send                                 → the automated A2P platform send
//
// Both already enforce, internally, the full unified send decision (CFE-cleared + approved +
// compliance-allowed [+ deliverable, platform only]); T-39's cadence engine should call these and
// react to the { status } result — it must NOT re-implement the gate chain or reach past this seam
// to the underlying T-36/T-38/CFE services directly. `SendComplianceGate.evaluate` is also the
// sanctioned PRE-check T-39 can call to decide whether to even schedule a cadence step (e.g. to
// defer past recipient quiet hours) before it ever calls `send`.

export {
  FirstTouchComposerService,
  toE164,
  type ComposerHandoffPayload,
  type ComposerHandoffResult,
  type ConfirmHandoffResult,
} from './first-touch-composer.service';

export {
  PlatformSmsSendService,
  type DeliverabilityCheck,
  type PlatformSmsSendDeps,
  type PlatformSendResult,
} from './platform-sms-send.service';

export {
  isDraftCfeCleared,
  resolveDraftClearance,
  type DraftClearance,
  type SendDraftFields,
  type SendHoldReason,
} from './send-decision';

export {
  createTwilioMessagingClient,
  isTwilioMessagingConfigured,
  InMemoryTwilioMessagingClient,
  LiveTwilioMessagingClient,
  type TwilioMessagingClient,
  type TwilioSendInput,
  type TwilioSendResult,
} from './twilio-messaging-client';

// T-39 (§10.5/§10.7) — the EMAIL send path (the third channel through this seam), gated identically
// (CFE-cleared + SendComplianceGate + isChannelDeliverable('EMAIL')) with a mockable, key-less-safe
// client. Sequences dispatch EMAIL steps through `EmailSendService.send`, never around it.
export {
  EmailSendService,
  type EmailSendDeps,
  type EmailDeliverabilityCheck,
  type EmailSenderIdentity,
  type EmailSendResultOut,
} from './email-send.service';

export {
  createEmailSendClient,
  isEmailSendConfigured,
  resolveEmailFrom,
  InMemoryEmailSendClient,
  LiveEmailSendClient,
  EMAIL_SEND_API_KEY_ENV_VAR,
  EMAIL_SEND_FROM_ENV_VAR,
  type EmailSendClient,
  type EmailSendInput,
  type EmailSendResult,
} from './email-send-client';

export {
  linkCfeAuditForSend,
  type SendContactRow,
  type SendPrismaClient,
  type PhoneDecryptor,
  type EmailDecryptor,
  type BodyEncryptor,
} from './send-support';
