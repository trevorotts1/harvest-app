// T-39 (WP05 §10.2 outreach sequences / §10.4 quiet-hours+opt-out / §10.8 pause-on-reply) — the
// cadence ENGINE teeth. Proves the engine can only EVER send a step by handing its draft to the
// dispatcher (the T-37 seam) — it has NO message.create / no client of its own — and that the
// pre-schedule SendComplianceGate + the seam's { status } result drive PAUSE/STOP/DEFER exactly per
// §10.8. Runs entirely KEY-LESS (the gate's sub-checks are DI-mocked; the engine is pure logic over
// an in-memory Prisma). The "goes-through-the-real-seam, blocked→HELD-not-sent" teeth live in
// email-send.service.test.ts (a REAL EmailSendService behind a REAL SeamSequenceDispatcher).

import { MessageChannel } from '@prisma/client';

import {
  SequenceService,
  type SequenceDispatcher,
  type SequenceDispatchResult,
  type SequencePrismaClient,
  type SequenceRow,
  type SequenceStepRow,
} from './sequence.service';
import { buildSchedule, CADENCE_PHASES, CADENCE_TEMPLATES, isSequenceType, SEQUENCE_TYPES } from './sequence-cadence';
import { SendComplianceGate } from '../../compliance/send-gate/send-compliance-gate';
import type { SendContactRow } from '../send';
import type { OptOutRegistryService } from '../../compliance/opt-out/opt-out-registry';
import type { MessagingConsentLedger } from '../../compliance/messaging-consent/messaging-consent-ledger';

const DAYTIME = new Date('2026-07-15T19:00:00Z'); // 3 PM EDT — outside quiet hours
const ORG = 'org-1';

function makeGate(opts: { optedOut?: boolean; hasConsent?: boolean } = {}): SendComplianceGate {
  return new SendComplianceGate(
    { isOptedOut: async () => opts.optedOut ?? false } as unknown as OptOutRegistryService,
    { hasMessagingConsent: async () => opts.hasConsent ?? true } as unknown as MessagingConsentLedger
  );
}

function contactRow(overrides: Partial<SendContactRow> = {}): SendContactRow {
  return {
    id: 'c-1',
    user_id: 'rep-1',
    phone: 'ENV',
    phone_hash: 'ph-1',
    email_hash: 'eh-1',
    timezone: 'America/New_York',
    email: 'ENV_EMAIL',
    ...overrides,
  };
}

interface Stores {
  sequences: Map<string, SequenceRow>;
  steps: SequenceStepRow[];
  contacts: Map<string, SendContactRow>;
  /** A canary: the engine must NEVER write a Message directly — it has no message delegate at all.
   *  If a future refactor added one and used it, this array would be the only place a send could be
   *  recorded outside the dispatcher; we assert the delegate is absent. */
}

function makePrisma(seed: { contacts?: SendContactRow[] } = {}): { prisma: SequencePrismaClient; stores: Stores } {
  const stores: Stores = {
    sequences: new Map(),
    steps: [],
    contacts: new Map((seed.contacts ?? [contactRow()]).map((c) => [c.id, { ...c }])),
  };
  let seqN = 0;
  let stepN = 0;
  const prisma: SequencePrismaClient = {
    outreachSequence: {
      findFirst: async ({ where }) => {
        const s = stores.sequences.get(where.id);
        return s && s.user_id === where.user_id ? { ...s } : null;
      },
      create: async ({ data }) => {
        const row: SequenceRow = {
          id: `seq-${++seqN}`,
          user_id: String(data.user_id),
          contact_id: String(data.contact_id),
          sequence_type: String(data.sequence_type),
          state: String(data.state ?? 'ACTIVE'),
          pause_reason: (data.pause_reason as string | null) ?? null,
          current_step_index: Number(data.current_step_index ?? 0),
          started_at: DAYTIME,
          updated_at: DAYTIME,
        };
        stores.sequences.set(row.id, row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = stores.sequences.get(where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    },
    outreachSequenceStep: {
      findMany: async ({ where, orderBy }) => {
        let rows = stores.steps.filter((s) => s.sequence_id === where.sequence_id);
        if (orderBy?.step_index === 'asc') rows = [...rows].sort((a, b) => a.step_index - b.step_index);
        return rows.map((r) => ({ ...r }));
      },
      create: async ({ data }) => {
        const row: SequenceStepRow = {
          id: `step-${++stepN}`,
          sequence_id: String(data.sequence_id),
          step_index: Number(data.step_index),
          channel: data.channel as MessageChannel,
          scheduled_at: data.scheduled_at as Date,
          status: String(data.status ?? 'SCHEDULED'),
          draft_id: (data.draft_id as string | null) ?? null,
          send_hold_reason: (data.send_hold_reason as string | null) ?? null,
          sent_message_id: (data.sent_message_id as string | null) ?? null,
          dispatched_at: (data.dispatched_at as Date | null) ?? null,
        };
        stores.steps.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = stores.steps.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    },
    contact: {
      findFirst: async ({ where }) => {
        const c = stores.contacts.get(where.id);
        return c && c.user_id === where.user_id ? { ...c } : null;
      },
    },
  };
  return { prisma, stores };
}

/** A dispatcher that hands back a queued sequence of results and records every call — so a test can
 *  assert both WHAT the engine did with a result AND (the teeth) whether the seam was even reached. */
function queuedDispatcher(results: SequenceDispatchResult[]): SequenceDispatcher & { calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    dispatch: async (input) => {
      calls.push(input);
      return results[i++] ?? { status: 'NOT_FOUND' };
    },
  };
}

async function enrollActive(
  service: SequenceService,
  prisma: SequencePrismaClient,
  stores: Stores,
  channel: MessageChannel = MessageChannel.SMS_PLATFORM
): Promise<string> {
  // Seed one ACTIVE sequence with a single already-due step carrying a draft.
  const seq = await prisma.outreachSequence.create({
    data: { user_id: 'rep-1', contact_id: 'c-1', sequence_type: 'STANDARD', state: 'ACTIVE', current_step_index: 0 },
  });
  await prisma.outreachSequenceStep.create({
    data: {
      sequence_id: seq.id,
      step_index: 0,
      channel,
      scheduled_at: new Date(DAYTIME.getTime() - 1000),
      status: 'SCHEDULED',
      draft_id: 'd-1',
    },
  });
  void service;
  void stores;
  return seq.id;
}

describe('SequenceService — the engine has no send of its own: every touch goes through the dispatcher (§10.2)', () => {
  test('TEETH: a fully-clear due step is SENT only via the dispatcher; the engine never writes a Message itself', async () => {
    const { prisma, stores } = makePrisma();
    const dispatcher = queuedDispatcher([{ status: 'SENT', messageId: 'msg-1' }]);
    const service = new SequenceService(prisma, dispatcher, makeGate());
    const seqId = await enrollActive(service, prisma, stores);

    const summary = await service.runDueSteps('rep-1', seqId, { organizationId: ORG }, DAYTIME);

    // The ONLY send channel is the dispatcher — it was called exactly once with the step's draft.
    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0]).toMatchObject({ userId: 'rep-1', draftId: 'd-1', organizationId: ORG });
    expect(summary.sent).toBe(1);
    expect(stores.steps[0].status).toBe('SENT');
    expect(stores.steps[0].sent_message_id).toBe('msg-1');
    // Structural guarantee: the SequencePrismaClient the engine is built on has NO `message` delegate,
    // so there is no code path by which the engine could persist an un-gated send around the seam.
    expect((prisma as unknown as { message?: unknown }).message).toBeUndefined();
  });
});

describe('SequenceService — pre-schedule SendComplianceGate blocks BEFORE the seam is ever called (§10.4)', () => {
  test('TEETH: an opted-out recipient STOPS the sequence and the dispatcher is NEVER called (no send attempt)', async () => {
    const { prisma, stores } = makePrisma();
    const dispatcher = queuedDispatcher([{ status: 'SENT', messageId: 'should-not-happen' }]);
    const service = new SequenceService(prisma, dispatcher, makeGate({ optedOut: true }));
    const seqId = await enrollActive(service, prisma, stores);

    const summary = await service.runDueSteps('rep-1', seqId, { organizationId: ORG }, DAYTIME);

    expect(dispatcher.calls).toHaveLength(0); // never even attempted a dispatch
    expect(summary.state).toBe('STOPPED');
    expect(summary.pauseReason).toBe('OPT_OUT');
    expect(stores.steps[0].status).toBe('HELD');
    expect(stores.steps[0].send_hold_reason).toBe('OPTED_OUT');
    expect(stores.sequences.get(seqId)!.state).toBe('STOPPED');
  });

  test('quiet hours DEFERS the step and keeps the sequence ACTIVE (retried later), no dispatch', async () => {
    const { prisma, stores } = makePrisma({ contacts: [contactRow({ timezone: null })] }); // unknown tz → fail-closed quiet hours
    const dispatcher = queuedDispatcher([{ status: 'SENT' }]);
    const service = new SequenceService(prisma, dispatcher, makeGate());
    const seqId = await enrollActive(service, prisma, stores);

    const summary = await service.runDueSteps('rep-1', seqId, { organizationId: ORG }, DAYTIME);

    expect(dispatcher.calls).toHaveLength(0);
    expect(stores.steps[0].status).toBe('DEFERRED');
    expect(summary.state).toBe('ACTIVE');
    expect(stores.sequences.get(seqId)!.state).toBe('ACTIVE');
  });

  test('missing TCPA consent (platform channel) PAUSES the sequence COMPLIANCE_BLOCK, no dispatch', async () => {
    const { prisma, stores } = makePrisma();
    const dispatcher = queuedDispatcher([{ status: 'SENT' }]);
    const service = new SequenceService(prisma, dispatcher, makeGate({ hasConsent: false }));
    const seqId = await enrollActive(service, prisma, stores, MessageChannel.SMS_PLATFORM);

    const summary = await service.runDueSteps('rep-1', seqId, { organizationId: ORG }, DAYTIME);

    expect(dispatcher.calls).toHaveLength(0);
    expect(summary.state).toBe('PAUSED');
    expect(summary.pauseReason).toBe('COMPLIANCE_BLOCK');
    expect(stores.steps[0].status).toBe('HELD');
    expect(stores.steps[0].send_hold_reason).toBe('NO_TCPA_CONSENT');
  });
});

describe('SequenceService — the seam { status } result drives PAUSE / STOP / DEFER (§10.8)', () => {
  test('the seam HELDs (e.g. NOT_CFE_CLEARED) → step HELD not SENT + sequence PAUSED COMPLIANCE_BLOCK', async () => {
    const { prisma, stores } = makePrisma();
    const dispatcher = queuedDispatcher([{ status: 'HELD', reason: 'NOT_CFE_CLEARED' }]);
    const service = new SequenceService(prisma, dispatcher, makeGate());
    const seqId = await enrollActive(service, prisma, stores);

    const summary = await service.runDueSteps('rep-1', seqId, { organizationId: ORG }, DAYTIME);

    expect(dispatcher.calls).toHaveLength(1); // it DID go through the seam
    expect(summary.sent).toBe(0);
    expect(stores.steps[0].status).toBe('HELD');
    expect(stores.steps[0].send_hold_reason).toBe('NOT_CFE_CLEARED');
    expect(summary.state).toBe('PAUSED');
    expect(summary.pauseReason).toBe('COMPLIANCE_BLOCK');
  });

  test('the seam catches an opt-out the pre-check raced past → STOP', async () => {
    const { prisma, stores } = makePrisma();
    const dispatcher = queuedDispatcher([{ status: 'HELD', reason: 'OPTED_OUT' }]);
    const service = new SequenceService(prisma, dispatcher, makeGate());
    const seqId = await enrollActive(service, prisma, stores);

    const summary = await service.runDueSteps('rep-1', seqId, { organizationId: ORG }, DAYTIME);
    expect(summary.state).toBe('STOPPED');
    expect(stores.sequences.get(seqId)!.state).toBe('STOPPED');
  });

  test('a delivery FAILURE (not a gate block) keeps the sequence ACTIVE and does not advance', async () => {
    const { prisma, stores } = makePrisma();
    const dispatcher = queuedDispatcher([{ status: 'FAILED' }]);
    const service = new SequenceService(prisma, dispatcher, makeGate());
    const seqId = await enrollActive(service, prisma, stores);

    const summary = await service.runDueSteps('rep-1', seqId, { organizationId: ORG }, DAYTIME);
    expect(stores.steps[0].status).toBe('FAILED');
    expect(summary.state).toBe('ACTIVE');
    expect(stores.sequences.get(seqId)!.current_step_index).toBe(0); // never advanced
  });

  test('a step with no draft HELDs (NO_DRAFT) without advancing or dispatching', async () => {
    const { prisma, stores } = makePrisma();
    const dispatcher = queuedDispatcher([{ status: 'SENT' }]);
    const service = new SequenceService(prisma, dispatcher, makeGate());
    const seq = await prisma.outreachSequence.create({
      data: { user_id: 'rep-1', contact_id: 'c-1', sequence_type: 'STANDARD', state: 'ACTIVE', current_step_index: 0 },
    });
    await prisma.outreachSequenceStep.create({
      data: { sequence_id: seq.id, step_index: 0, channel: MessageChannel.SMS_PLATFORM, scheduled_at: new Date(DAYTIME.getTime() - 1), status: 'SCHEDULED', draft_id: null },
    });
    const summary = await service.runDueSteps('rep-1', seq.id, { organizationId: ORG }, DAYTIME);
    expect(dispatcher.calls).toHaveLength(0);
    expect(stores.steps[0].status).toBe('HELD');
    expect(stores.steps[0].send_hold_reason).toBe('NO_DRAFT');
    expect(summary.state).toBe('ACTIVE');
  });
});

describe('SequenceService — PAUSE on reply / STOP on opt-out / resume; a non-ACTIVE sequence never fires (§10.8)', () => {
  test('pauseOnReply PAUSES with REPLY; a paused sequence then runs as a NO-OP (dispatcher untouched)', async () => {
    const { prisma, stores } = makePrisma();
    const dispatcher = queuedDispatcher([{ status: 'SENT' }]);
    const service = new SequenceService(prisma, dispatcher, makeGate());
    const seqId = await enrollActive(service, prisma, stores);

    const paused = await service.pauseOnReply('rep-1', seqId, DAYTIME);
    expect(paused?.state).toBe('PAUSED');
    expect(paused?.pause_reason).toBe('REPLY');

    const summary = await service.runDueSteps('rep-1', seqId, { organizationId: ORG }, DAYTIME);
    expect(dispatcher.calls).toHaveLength(0); // TEETH: a paused sequence NEVER fires another step
    expect(summary.state).toBe('PAUSED');
    expect(stores.steps[0].status).toBe('SCHEDULED'); // untouched
  });

  test('stopOnOptOut STOPS permanently; pauseOnReply never resurrects a STOPPED sequence', async () => {
    const { prisma, stores } = makePrisma();
    const service = new SequenceService(prisma, queuedDispatcher([]), makeGate());
    const seqId = await enrollActive(service, prisma, stores);

    const stopped = await service.stopOnOptOut('rep-1', seqId, DAYTIME);
    expect(stopped?.state).toBe('STOPPED');
    const stillStopped = await service.pauseOnReply('rep-1', seqId, DAYTIME);
    expect(stillStopped?.state).toBe('STOPPED');
  });

  test('resume moves PAUSED → ACTIVE (never a STOPPED/COMPLETED one)', async () => {
    const { prisma, stores } = makePrisma();
    const service = new SequenceService(prisma, queuedDispatcher([]), makeGate());
    const seqId = await enrollActive(service, prisma, stores);
    await service.pauseOnReply('rep-1', seqId, DAYTIME);
    const resumed = await service.resume('rep-1', seqId);
    expect(resumed?.state).toBe('ACTIVE');
    expect(resumed?.pause_reason).toBeNull();

    await service.stopOnOptOut('rep-1', seqId, DAYTIME);
    const notResumed = await service.resume('rep-1', seqId);
    expect(notResumed?.state).toBe('STOPPED'); // resume refuses a stopped sequence
  });
});

describe('SequenceService — OWNERSHIP: a forged/mismatched user_id is inert (§2.5)', () => {
  test('runDueSteps for another rep is NOT_FOUND and never dispatches', async () => {
    const { prisma, stores } = makePrisma();
    const dispatcher = queuedDispatcher([{ status: 'SENT' }]);
    const service = new SequenceService(prisma, dispatcher, makeGate());
    const seqId = await enrollActive(service, prisma, stores);

    const summary = await service.runDueSteps('rep-999', seqId, { organizationId: ORG }, DAYTIME);
    expect(summary.state).toBe('NOT_FOUND');
    expect(dispatcher.calls).toHaveLength(0);
    expect(stores.steps[0].status).toBe('SCHEDULED');
  });

  test('pauseOnReply / stopOnOptOut / getSequence for another rep return null', async () => {
    const { prisma, stores } = makePrisma();
    const service = new SequenceService(prisma, queuedDispatcher([]), makeGate());
    const seqId = await enrollActive(service, prisma, stores);
    expect(await service.pauseOnReply('rep-999', seqId)).toBeNull();
    expect(await service.stopOnOptOut('rep-999', seqId)).toBeNull();
    expect(await service.getSequence('rep-999', seqId)).toBeNull();
  });
});

describe('sequence-cadence — the doctrine arc is deterministic and doctrine-safe (§10.2)', () => {
  test('every sequence type materializes a schedule; first automated-SMS/handoff touch is warm_open', () => {
    for (const type of SEQUENCE_TYPES) {
      const schedule = buildSchedule(type, DAYTIME);
      expect(schedule.length).toBeGreaterThanOrEqual(2);
      expect(schedule[0].phase).toBe('warm_open');
      expect(schedule[0].stepIndex).toBe(0);
      // Offsets are non-decreasing (never a harder ask sooner) and each phase is in the closed set.
      let prev = -1;
      for (const step of schedule) {
        expect(step.scheduledAt.getTime()).toBeGreaterThanOrEqual(prev);
        prev = step.scheduledAt.getTime();
        expect(CADENCE_PHASES).toContain(step.phase);
      }
    }
  });

  test('FAST_TRACK / STANDARD / NURTURE lead with the rep-own-number composer handoff (SMS_HANDOFF)', () => {
    for (const type of ['FAST_TRACK', 'STANDARD', 'NURTURE'] as const) {
      expect(CADENCE_TEMPLATES[type].steps[0].channel).toBe(MessageChannel.SMS_HANDOFF);
    }
  });

  test('RE_ENGAGEMENT honors a custom intervalDays override', () => {
    const schedule = buildSchedule('RE_ENGAGEMENT', DAYTIME, [0, 3]);
    expect(schedule[1].scheduledAt.getTime()).toBe(DAYTIME.getTime() + 3 * 24 * 60 * 60 * 1000);
  });

  test('isSequenceType guards the closed set', () => {
    expect(isSequenceType('STANDARD')).toBe(true);
    expect(isSequenceType('NLP_CLOSE')).toBe(false);
    expect(isSequenceType(42)).toBe(false);
  });
});
