// T-37 (WP05 §10.1 "the two SMS paths, honestly engineered"; §2.3 "approval always precedes send";
// §5.2 fail-closed; §18.1 "edited-after-approval re-enters the CFE") — the SHARED send-decision
// core both SMS send paths are built on. This module is deliberately PURE (no I/O, no Prisma, no
// keys, no network) so the single invariant it expresses — "neither path may dispatch content that
// is not CFE-cleared AND human-approved" — is one testable function, not two copies.
//
// It CONSUMES the DraftMessage state WP04's Approval Inbox already produced (`cfe_outcome` /
// `approval_state` / `edited_after_approval`); it never re-runs the CFE engine (that would be
// re-inventing §5, and would need a live key — breaking the key-less contract). The Approval Inbox
// (src/services/approval-inbox/approval-inbox.service.ts) guarantees a HELD/blocked draft can never
// reach `approval_state === 'APPROVED'`; this module additionally re-asserts the released CFE
// outcome at dispatch, deny-by-default, so a hand-crafted/raced row can never leak a send either.

import { CFEOutcome, MessageChannel } from '@prisma/client';

/** Every reason the unified send decision may withhold a dispatch. Persisted to
 *  `DraftMessage.send_hold_reason` (T-37 migration) and returned to the caller. NONE of these ever
 *  resolves to "safe to send" — deny-by-default (§5.2). */
export type SendHoldReason =
  /** The persisted CFE verdict is not a RELEASED outcome (BLOCK / RECORDED / null) — the CFE held
   *  or blocked this content, so it can never be sent on either path (§5.2). */
  | 'NOT_CFE_CLEARED'
  /** The draft has not been human-approved in the Approval Inbox — approval always precedes send
   *  (§2.3). */
  | 'NOT_APPROVED'
  /** The body changed after approval and has not been re-approved — §18.1 requires it re-enter the
   *  CFE (the Approval Inbox's `editDraft` does that and voids the approval); a send must refuse
   *  until then. */
  | 'EDITED_AFTER_APPROVAL'
  /** The draft's channel does not match the send path invoked (a SMS_PLATFORM draft cannot be sent
   *  via the composer handoff, and vice-versa). */
  | 'CHANNEL_MISMATCH'
  /** SendComplianceGate (T-38): a global, permanent, cross-rep opt-out is on file (§10.4/§3.4). */
  | 'OPTED_OUT'
  /** SendComplianceGate (T-38): outside 8 AM–9 PM in the RECIPIENT's own timezone (§10.4). */
  | 'QUIET_HOURS'
  /** SendComplianceGate (T-38): no valid TCPA per-contact consent (automated platform cadence
   *  only — §16.2/§16.3). */
  | 'NO_TCPA_CONSENT'
  /** isChannelDeliverable (T-36): A2P 10DLC provisioning is not APPROVED for this org — the
   *  platform number is not sendable (§10.3/SC5). Never applies to the composer handoff. */
  | 'NOT_DELIVERABLE'
  /** The Twilio messaging credentials (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) are absent — the
   *  platform send fails SAFE (no send, no crash), never fabricating a delivered result (§0.4). */
  | 'TWILIO_UNCONFIGURED'
  /** A2P is APPROVED but no platform from-number resolved — fail-closed rather than guess a
   *  sender. */
  | 'NO_PLATFORM_NUMBER'
  /** The recipient has no phone on file (or it could not be decrypted) — nothing to compose/send
   *  to. */
  | 'NO_PHONE'
  /** Deny-by-default: any unexpected error in the send decision. Never a send. */
  | 'ERROR';

/** The subset of a `DraftMessage` row the send decision reads. A narrow, DI-mockable shape (same
 *  convention as ApprovalInboxService's `DraftMessageRow`) — a caller passes only what the decision
 *  needs, never the full generated Prisma row. */
export interface SendDraftFields {
  id: string;
  user_id: string;
  contact_id: string;
  channel: MessageChannel;
  body: string;
  cfe_outcome: CFEOutcome | null;
  approval_state: string;
  edited_after_approval: boolean;
}

export type DraftClearance =
  | { cleared: true }
  | { cleared: false; reason: Extract<SendHoldReason, 'NOT_CFE_CLEARED' | 'NOT_APPROVED' | 'EDITED_AFTER_APPROVAL'> };

/** The RELEASED CFE outcomes (§5.4 band → outcome): the CFE cleared the content to a human-
 *  reviewable state (PASS = clear band; FLAG = review band, adjudicated + approvable). BLOCK (block
 *  band or a fail-closed hold) and RECORDED (a non-CFE audit marker) are NOT released, and neither
 *  is a null outcome (never evaluated). */
const RELEASED_CFE_OUTCOMES: ReadonlySet<CFEOutcome> = new Set([CFEOutcome.PASS, CFEOutcome.FLAG]);

/** True iff the draft carries a RELEASED CFE verdict — i.e. the CFE did not hold or block it. This
 *  is the "CFE-cleared (released)" predicate the whole send layer is gated on. */
export function isDraftCfeCleared(draft: Pick<SendDraftFields, 'cfe_outcome'>): boolean {
  return draft.cfe_outcome !== null && RELEASED_CFE_OUTCOMES.has(draft.cfe_outcome);
}

/**
 * THE unified draft-side send gate: a draft may be dispatched on EITHER path only if it is
 * CFE-cleared (released) AND human-approved AND not edited-since-approval. Checked in that order so
 * the CFE-clearance failure is the first, load-bearing reason a non-released draft is refused
 * (PROVE b: "a non-released CFE draft → never sent"). Pure and deny-by-default.
 */
export function resolveDraftClearance(draft: SendDraftFields): DraftClearance {
  if (!isDraftCfeCleared(draft)) {
    return { cleared: false, reason: 'NOT_CFE_CLEARED' };
  }
  if (draft.approval_state !== 'APPROVED') {
    return { cleared: false, reason: 'NOT_APPROVED' };
  }
  if (draft.edited_after_approval) {
    return { cleared: false, reason: 'EDITED_AFTER_APPROVAL' };
  }
  return { cleared: true };
}
