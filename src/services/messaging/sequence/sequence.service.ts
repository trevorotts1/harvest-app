// T-39 (WP05 §10.2 outreach sequence / §10.4 quiet-hours + opt-out / §10.8 edge cases) — the cadence
// ENGINE. It owns "which touch fires when, and what to do with the result", and NOTHING about how a
// send is gated or dispatched: every touch goes THROUGH the T-37 send seam (`SequenceDispatcher`,
// whose only production implementation calls FirstTouchComposerService / PlatformSmsSendService /
// EmailSendService). The engine has no `message.create`, no Twilio/email client, no CFE — so there is
// no code path by which a step could send around the gates. A step that the seam HELDs (not CFE-
// cleared, opted-out, quiet hours, not deliverable, unconfigured credential, …) is recorded HELD and
// NOT sent; the seam's per-send gate is authoritative.
//
// Two compliance interactions, both from the brief:
//   • PRE-SCHEDULE check (§10.4) — before it even asks the seam to dispatch, the engine calls
//     SendComplianceGate.evaluate to avoid dispatching into recipient quiet hours (defer the step)
//     or to an opted-out contact (stop the sequence). An optimization, not the authority.
//   • PER-SEND gate — the seam re-checks at dispatch; the engine reacts to its { status } result.
//
// PAUSE/STOP semantics (§10.8): an inbound reply pauses the sequence (REPLY); an opt-out stops it
// (OPT_OUT); a compliance HELD other than quiet-hours pauses it (COMPLIANCE_BLOCK). A non-ACTIVE
// sequence NEVER fires another step — `runDueSteps` returns immediately.

import { MessageChannel } from '@prisma/client';

import { SendComplianceGate } from '../../compliance/send-gate/send-compliance-gate';
import type { SendContactRow, SendHoldReason } from '../send';
import type { FirstTouchComposerService } from '../send';
import type { PlatformSmsSendService } from '../send';
import type { EmailSendService } from '../send';
import { toComplianceContact } from '../send/send-support';
import { buildSchedule, type SequenceType } from './sequence-cadence';

// ─── Persisted row shapes (narrow, DI-mockable — same convention as the send seam) ────────────────

export interface SequenceRow {
  id: string;
  user_id: string;
  contact_id: string;
  sequence_type: string;
  state: string; // ACTIVE | PAUSED | STOPPED | COMPLETED
  pause_reason: string | null;
  current_step_index: number;
  started_at: Date;
  updated_at: Date;
}

export interface SequenceStepRow {
  id: string;
  sequence_id: string;
  step_index: number;
  channel: MessageChannel;
  scheduled_at: Date;
  status: string; // SCHEDULED | SENT | HELD | DEFERRED | FAILED | SKIPPED | CANCELED
  draft_id: string | null;
  send_hold_reason: string | null;
  sent_message_id: string | null;
  dispatched_at: Date | null;
}

export interface SequencePrismaClient {
  outreachSequence: {
    findFirst(args: { where: { id: string; user_id: string } }): Promise<SequenceRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<SequenceRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<SequenceRow>;
  };
  outreachSequenceStep: {
    findMany(args: {
      where: { sequence_id: string };
      orderBy?: { step_index: 'asc' | 'desc' };
    }): Promise<SequenceStepRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<SequenceStepRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<SequenceStepRow>;
  };
  contact: {
    findFirst(args: {
      where: { id: string; user_id: string };
      select: { id: true; user_id: true; phone: true; phone_hash: true; email_hash: true; timezone: true; email?: true };
    }): Promise<SendContactRow | null>;
  };
}

// ─── The seam boundary the engine dispatches through ──────────────────────────────────────────────

export interface SequenceStepDispatch {
  userId: string;
  draftId: string;
  channel: MessageChannel;
  organizationId: string;
  sendingDomain?: string | null;
  now: Date;
}

export interface SequenceDispatchResult {
  status: 'SENT' | 'HELD' | 'FAILED' | 'NOT_FOUND';
  reason?: SendHoldReason;
  messageId?: string;
}

/** THE only thing the engine can do to send a step. Its production implementation
 *  (`SeamSequenceDispatcher`) routes to the T-37 seam by channel and nothing else. */
export interface SequenceDispatcher {
  dispatch(input: SequenceStepDispatch): Promise<SequenceDispatchResult>;
}

/**
 * The production dispatcher: routes each channel to its T-37 seam service and maps the result onto
 * the engine's neutral `SequenceDispatchResult`. First-touch (SMS_HANDOFF) "dispatch" is a composer
 * handoff (READY = handed off to the rep's own number); the platform SMS and email paths are true
 * automated sends. SOCIAL_DM / IN_APP have no automated send path here → HELD (deny-by-default).
 */
export class SeamSequenceDispatcher implements SequenceDispatcher {
  constructor(
    private readonly firstTouch: Pick<FirstTouchComposerService, 'prepareHandoff'>,
    private readonly platformSms: Pick<PlatformSmsSendService, 'send'>,
    private readonly email: Pick<EmailSendService, 'send'>
  ) {}

  async dispatch(input: SequenceStepDispatch): Promise<SequenceDispatchResult> {
    switch (input.channel) {
      case MessageChannel.SMS_HANDOFF: {
        const r = await this.firstTouch.prepareHandoff(input.userId, input.draftId, input.now);
        if (r.status === 'READY') return { status: 'SENT', messageId: r.messageId };
        if (r.status === 'HELD') return { status: 'HELD', reason: r.reason };
        return { status: 'NOT_FOUND' };
      }
      case MessageChannel.SMS_PLATFORM: {
        const r = await this.platformSms.send(input.userId, input.draftId, input.organizationId, input.now);
        if (r.status === 'SENT') return { status: 'SENT', messageId: r.messageId };
        if (r.status === 'HELD') return { status: 'HELD', reason: r.reason };
        if (r.status === 'FAILED') return { status: 'FAILED' };
        return { status: 'NOT_FOUND' };
      }
      case MessageChannel.EMAIL: {
        const r = await this.email.send(
          input.userId,
          input.draftId,
          input.organizationId,
          input.sendingDomain ?? null,
          undefined,
          input.now
        );
        if (r.status === 'SENT') return { status: 'SENT', messageId: r.messageId };
        if (r.status === 'HELD') return { status: 'HELD', reason: r.reason };
        if (r.status === 'FAILED') return { status: 'FAILED' };
        return { status: 'NOT_FOUND' };
      }
      default:
        // No automated cadence send path for SOCIAL_DM / IN_APP — deny-by-default, never a bypass.
        return { status: 'HELD', reason: 'CHANNEL_MISMATCH' };
    }
  }
}

export interface EnrollInput {
  userId: string;
  contactId: string;
  sequenceType: SequenceType;
  /** Optional per-step DraftMessage ids (from WP04). A step with no draft can't send yet — it HELDs
   *  (NO_DRAFT) at run time without advancing, waiting for its content. */
  stepDraftIds?: (string | null)[];
  /** RE_ENGAGEMENT's "custom" interval override (§10.2). */
  intervalDays?: number[];
}

export interface RunContext {
  organizationId: string;
  sendingDomain?: string | null;
}

export interface RunSummary {
  sequenceId: string;
  state: string;
  pauseReason: string | null;
  /** How many steps this tick attempted to dispatch (SENT + HELD + FAILED + DEFERRED). */
  processed: number;
  sent: number;
  outcomes: { stepIndex: number; result: string; reason?: string }[];
}

/** Pause reasons persisted to OutreachSequence.pause_reason. */
type PauseReason = 'REPLY' | 'OPT_OUT' | 'COMPLIANCE_BLOCK' | 'MANUAL';

export class SequenceService {
  private readonly gate: SendComplianceGate;

  constructor(
    private prisma: SequencePrismaClient,
    private dispatcher: SequenceDispatcher,
    gate: SendComplianceGate = new SendComplianceGate()
  ) {
    this.gate = gate;
  }

  /** Enroll a contact into a doctrine-safe cadence. Creates the sequence + its scheduled steps. */
  async enroll(input: EnrollInput, now: Date = new Date()): Promise<{ sequence: SequenceRow; steps: SequenceStepRow[] }> {
    const schedule = buildSchedule(input.sequenceType, now, input.intervalDays);
    const sequence = await this.prisma.outreachSequence.create({
      data: {
        user_id: input.userId,
        contact_id: input.contactId,
        sequence_type: input.sequenceType,
        state: 'ACTIVE',
        current_step_index: 0,
      },
    });
    const steps: SequenceStepRow[] = [];
    for (const s of schedule) {
      const step = await this.prisma.outreachSequenceStep.create({
        data: {
          sequence_id: sequence.id,
          step_index: s.stepIndex,
          channel: s.channel,
          scheduled_at: s.scheduledAt,
          status: 'SCHEDULED',
          draft_id: input.stepDraftIds?.[s.stepIndex] ?? null,
        },
      });
      steps.push(step);
    }
    return { sequence, steps };
  }

  async getSequence(userId: string, sequenceId: string): Promise<{ sequence: SequenceRow; steps: SequenceStepRow[] } | null> {
    const sequence = await this.prisma.outreachSequence.findFirst({ where: { id: sequenceId, user_id: userId } });
    if (!sequence) return null;
    const steps = await this.prisma.outreachSequenceStep.findMany({
      where: { sequence_id: sequence.id },
      orderBy: { step_index: 'asc' },
    });
    return { sequence, steps };
  }

  /**
   * The cadence tick. Fires every step that is DUE, IN ORDER, through the seam — stopping the moment
   * the sequence leaves ACTIVE (so it can never "keep firing" after a reply/opt-out/block). A
   * non-ACTIVE sequence is a no-op. Ownership: scoped to (id, user_id).
   */
  async runDueSteps(userId: string, sequenceId: string, ctx: RunContext, now: Date = new Date()): Promise<RunSummary> {
    const sequence = await this.prisma.outreachSequence.findFirst({ where: { id: sequenceId, user_id: userId } });
    if (!sequence) {
      return { sequenceId, state: 'NOT_FOUND', pauseReason: null, processed: 0, sent: 0, outcomes: [] };
    }
    const summary: RunSummary = {
      sequenceId,
      state: sequence.state,
      pauseReason: sequence.pause_reason,
      processed: 0,
      sent: 0,
      outcomes: [],
    };
    // A paused/stopped/completed sequence NEVER fires another step (§10.8).
    if (sequence.state !== 'ACTIVE') return summary;

    const contact = await this.prisma.contact.findFirst({
      where: { id: sequence.contact_id, user_id: userId },
      select: { id: true, user_id: true, phone: true, phone_hash: true, email_hash: true, timezone: true, email: true },
    });

    const allSteps = await this.prisma.outreachSequenceStep.findMany({
      where: { sequence_id: sequence.id },
      orderBy: { step_index: 'asc' },
    });

    let currentIndex = sequence.current_step_index;
    let active = true;

    while (active) {
      // The next runnable step: due (SCHEDULED/DEFERRED, scheduled_at <= now) at or after the cursor.
      const step = allSteps.find(
        (s) =>
          s.step_index >= currentIndex &&
          (s.status === 'SCHEDULED' || s.status === 'DEFERRED') &&
          s.scheduled_at.getTime() <= now.getTime()
      );
      if (!step) break;

      summary.processed += 1;

      if (!contact) {
        await this.holdStep(step.id, 'NO_CONTACT');
        summary.outcomes.push({ stepIndex: step.step_index, result: 'HELD', reason: 'NO_CONTACT' });
        break;
      }
      if (!step.draft_id) {
        await this.holdStep(step.id, 'NO_DRAFT');
        summary.outcomes.push({ stepIndex: step.step_index, result: 'HELD', reason: 'NO_DRAFT' });
        break; // content not ready — wait, do not advance, keep sequence ACTIVE.
      }

      // ── PRE-SCHEDULE compliance check (§10.4) — avoid dispatching into quiet hours / to opt-out ──
      const pre = await this.gate.evaluate(toComplianceContact(contact), step.channel, now);
      if (!pre.allowed) {
        if (pre.reason === 'OPTED_OUT') {
          await this.holdStep(step.id, 'OPTED_OUT');
          await this.stop(sequence.id, 'OPT_OUT', now);
          summary.state = 'STOPPED';
          summary.pauseReason = 'OPT_OUT';
          summary.outcomes.push({ stepIndex: step.step_index, result: 'STOPPED', reason: 'OPTED_OUT' });
          active = false;
          break;
        }
        if (pre.reason === 'QUIET_HOURS') {
          await this.deferStep(step.id, 'QUIET_HOURS');
          summary.outcomes.push({ stepIndex: step.step_index, result: 'DEFERRED', reason: 'QUIET_HOURS' });
          break; // try again after the recipient's window opens.
        }
        // NO_TCPA_CONSENT / ERROR → a compliance block; pause for the rep.
        await this.holdStep(step.id, pre.reason);
        await this.pause(sequence.id, 'COMPLIANCE_BLOCK', now);
        summary.state = 'PAUSED';
        summary.pauseReason = 'COMPLIANCE_BLOCK';
        summary.outcomes.push({ stepIndex: step.step_index, result: 'HELD', reason: pre.reason });
        active = false;
        break;
      }

      // ── DISPATCH through the seam (authoritative per-send gate) ─────────────────────────────────
      const result = await this.dispatcher.dispatch({
        userId,
        draftId: step.draft_id,
        channel: step.channel,
        organizationId: ctx.organizationId,
        sendingDomain: ctx.sendingDomain,
        now,
      });

      if (result.status === 'SENT') {
        await this.prisma.outreachSequenceStep.update({
          where: { id: step.id },
          data: { status: 'SENT', sent_message_id: result.messageId ?? null, send_hold_reason: null, dispatched_at: now },
        });
        currentIndex = step.step_index + 1;
        await this.prisma.outreachSequence.update({
          where: { id: sequence.id },
          data: { current_step_index: currentIndex, ...(currentIndex >= allSteps.length ? { state: 'COMPLETED' } : {}) },
        });
        summary.sent += 1;
        summary.outcomes.push({ stepIndex: step.step_index, result: 'SENT' });
        if (currentIndex >= allSteps.length) {
          summary.state = 'COMPLETED';
          active = false;
        }
        continue; // process the next due step, if any.
      }

      if (result.status === 'HELD' && result.reason === 'OPTED_OUT') {
        // The seam caught an opt-out the pre-check missed (a cross-rep propagation race) — stop.
        await this.holdStep(step.id, 'OPTED_OUT');
        await this.stop(sequence.id, 'OPT_OUT', now);
        summary.state = 'STOPPED';
        summary.pauseReason = 'OPT_OUT';
        summary.outcomes.push({ stepIndex: step.step_index, result: 'STOPPED', reason: 'OPTED_OUT' });
        active = false;
        break;
      }
      if (result.status === 'HELD' && result.reason === 'QUIET_HOURS') {
        await this.deferStep(step.id, 'QUIET_HOURS');
        summary.outcomes.push({ stepIndex: step.step_index, result: 'DEFERRED', reason: 'QUIET_HOURS' });
        break;
      }
      if (result.status === 'HELD') {
        // Any other compliance/gate hold (not CFE-cleared, not deliverable, unconfigured credential,
        // channel mismatch, …) → surface to the rep; pause the sequence (§10.8 hold queue).
        await this.holdStep(step.id, result.reason ?? 'HELD');
        await this.pause(sequence.id, 'COMPLIANCE_BLOCK', now);
        summary.state = 'PAUSED';
        summary.pauseReason = 'COMPLIANCE_BLOCK';
        summary.outcomes.push({ stepIndex: step.step_index, result: 'HELD', reason: result.reason });
        active = false;
        break;
      }
      if (result.status === 'FAILED') {
        // Delivery failure (not a gate block) — retryable; keep the sequence ACTIVE, do not advance.
        await this.prisma.outreachSequenceStep.update({
          where: { id: step.id },
          data: { status: 'FAILED', send_hold_reason: 'DELIVERY_FAILED' },
        });
        summary.outcomes.push({ stepIndex: step.step_index, result: 'FAILED' });
        break;
      }
      // NOT_FOUND — the draft vanished/ownership mismatch; hold, do not advance.
      await this.holdStep(step.id, 'DRAFT_NOT_FOUND');
      summary.outcomes.push({ stepIndex: step.step_index, result: 'HELD', reason: 'DRAFT_NOT_FOUND' });
      break;
    }

    return summary;
  }

  /** §10.8: an inbound reply pauses the sequence (human response takes priority). Ownership-scoped. */
  async pauseOnReply(userId: string, sequenceId: string, now: Date = new Date()): Promise<SequenceRow | null> {
    const sequence = await this.prisma.outreachSequence.findFirst({ where: { id: sequenceId, user_id: userId } });
    if (!sequence) return null;
    // Never resurrect a STOPPED (opt-out) sequence into PAUSED — a stop is terminal.
    if (sequence.state === 'STOPPED') return sequence;
    return this.pause(sequence.id, 'REPLY', now);
  }

  /** §10.4: an opt-out stops the sequence permanently. Ownership-scoped. */
  async stopOnOptOut(userId: string, sequenceId: string, now: Date = new Date()): Promise<SequenceRow | null> {
    const sequence = await this.prisma.outreachSequence.findFirst({ where: { id: sequenceId, user_id: userId } });
    if (!sequence) return null;
    return this.stop(sequence.id, 'OPT_OUT', now);
  }

  /** Resume a PAUSED sequence to ACTIVE (never a STOPPED/COMPLETED one). Ownership-scoped. */
  async resume(userId: string, sequenceId: string): Promise<SequenceRow | null> {
    const sequence = await this.prisma.outreachSequence.findFirst({ where: { id: sequenceId, user_id: userId } });
    if (!sequence) return null;
    if (sequence.state !== 'PAUSED') return sequence;
    return this.prisma.outreachSequence.update({
      where: { id: sequence.id },
      data: { state: 'ACTIVE', pause_reason: null },
    });
  }

  // ─── internals ─────────────────────────────────────────────────────────────────────────────────

  private async pause(sequenceId: string, reason: PauseReason, _now: Date): Promise<SequenceRow> {
    return this.prisma.outreachSequence.update({
      where: { id: sequenceId },
      data: { state: 'PAUSED', pause_reason: reason },
    });
  }

  private async stop(sequenceId: string, reason: PauseReason, _now: Date): Promise<SequenceRow> {
    return this.prisma.outreachSequence.update({
      where: { id: sequenceId },
      data: { state: 'STOPPED', pause_reason: reason },
    });
  }

  private async holdStep(stepId: string, reason: string): Promise<void> {
    await this.prisma.outreachSequenceStep.update({
      where: { id: stepId },
      data: { status: 'HELD', send_hold_reason: reason },
    });
  }

  private async deferStep(stepId: string, reason: string): Promise<void> {
    await this.prisma.outreachSequenceStep.update({
      where: { id: stepId },
      data: { status: 'DEFERRED', send_hold_reason: reason },
    });
  }
}
