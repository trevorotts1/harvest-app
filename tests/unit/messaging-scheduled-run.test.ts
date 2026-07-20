// T-40R (WP05 GATE remediation) — behavioral teeth for the two NEWLY-WIRED messaging cron handlers,
// the package-free logic the Inngest `{ cron }` wrappers call (messaging-inngest-functions.ts). Each
// block states the mutation that makes it fail. Runs entirely KEY-LESS: the email client is a null/
// in-memory DI double, the T-38 gate's sub-checks are DI-mocked; nothing reads a real key. This file
// never imports the `inngest` package — only the package-free handlers — mirroring
// tests/unit/scheduled-dispatch.test.ts's convention.

import { CFEOutcome, MessageChannel } from '@prisma/client';

import {
  runDueSequences,
  InMemoryDueSequenceStore,
  SCHEDULED_SEQUENCE_RUN_CRON,
  SCHEDULED_SEQUENCE_RUN_FUNCTION_ID,
  type SequenceRunner,
} from '@/services/messaging/sequence/sequence-scheduled-run';
import {
  runHandoffReturnSweep,
  InMemoryLapsedHandoffStore,
  HANDOFF_RETURN_SWEEP_CRON,
  HANDOFF_RETURN_SWEEP_FUNCTION_ID,
} from '@/services/messaging/handoff/handoff-return-sweep';
import {
  SequenceService,
  SeamSequenceDispatcher,
  type SequencePrismaClient,
  type SequenceRow,
  type SequenceStepRow,
} from '@/services/messaging/sequence/sequence.service';
import { EmailSendService } from '@/services/messaging/send/email-send.service';
import { InMemoryEmailSendClient } from '@/services/messaging/send/email-send-client';
import type { SendContactRow, SendPrismaClient } from '@/services/messaging/send/send-support';
import type { SendDraftFields } from '@/services/messaging/send/send-decision';
import { SendComplianceGate } from '@/services/compliance/send-gate/send-compliance-gate';
import type { OptOutRegistryService } from '@/services/compliance/opt-out/opt-out-registry';
import type { MessagingConsentLedger } from '@/services/compliance/messaging-consent/messaging-consent-ledger';
import {
  ThreeWayHandoffService,
  type HandoffRow,
  type ThreeWayHandoffPrismaClient,
} from '@/services/messaging/handoff/three-way-handoff.service';

const DAYTIME = new Date('2026-07-15T19:00:00Z'); // 3 PM EDT — outside recipient quiet hours
const ORG = 'org-1';
const DOMAIN = 'mail.example.org';

function makeGate(opts: { optedOut?: boolean; hasConsent?: boolean } = {}): SendComplianceGate {
  return new SendComplianceGate(
    { isOptedOut: async () => opts.optedOut ?? false } as unknown as OptOutRegistryService,
    { hasMessagingConsent: async () => opts.hasConsent ?? true } as unknown as MessagingConsentLedger
  );
}

// ── A COMBINED in-memory prisma covering BOTH the SequencePrismaClient surface (sequences/steps/
// contact) AND the SendPrismaClient surface (drafts/threads/messages) — so a REAL SequenceService can
// drive a REAL SeamSequenceDispatcher → REAL EmailSendService over one store, exactly as production
// does over the one prisma singleton. `messages` is the ONLY place a send is ever recorded; a gated-
// out send leaves it empty. ──────────────────────────────────────────────────────────────────────
interface Combined {
  sequences: Map<string, SequenceRow>;
  steps: SequenceStepRow[];
  contacts: Map<string, SendContactRow>;
  drafts: Map<string, SendDraftFields>;
  messages: Array<Record<string, unknown> & { id: string }>;
}

function draftRow(over: Partial<SendDraftFields> = {}): SendDraftFields {
  return {
    id: 'd-1',
    user_id: 'rep-1',
    contact_id: 'c-1',
    channel: MessageChannel.EMAIL,
    body: 'Just a warm note — no pressure at all, wanted to share something that might help.',
    cfe_outcome: CFEOutcome.PASS,
    approval_state: 'APPROVED',
    edited_after_approval: false,
    approved_by: 'rep-1',
    approved_at: new Date('2026-07-14T12:00:00Z'),
    cfe_risk_score: 3,
    cfe_classifier_data: { band: 'clear' },
    ...over,
  };
}
function contactRow(over: Partial<SendContactRow> = {}): SendContactRow {
  return { id: 'c-1', user_id: 'rep-1', phone: null, phone_hash: null, email_hash: 'eh-1', timezone: 'America/New_York', email: 'ENV_EMAIL', ...over };
}

function makeCombined(seed: { draft?: SendDraftFields } = {}): { prisma: SequencePrismaClient & SendPrismaClient; stores: Combined } {
  const stores: Combined = {
    sequences: new Map(),
    steps: [],
    contacts: new Map([['c-1', contactRow()]]),
    drafts: new Map([[(seed.draft ?? draftRow()).id, seed.draft ?? draftRow()]]),
    messages: [],
  };
  let seqN = 0;
  let stepN = 0;
  let threadN = 0;
  let msgN = 0;
  const threads: Array<{ id: string; user_id: string; contact_id: string; channel: MessageChannel }> = [];

  const prisma = {
    outreachSequence: {
      findFirst: async ({ where }: { where: { id: string; user_id: string } }) => {
        const s = stores.sequences.get(where.id);
        return s && s.user_id === where.user_id ? { ...s } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
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
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = stores.sequences.get(where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    },
    outreachSequenceStep: {
      findMany: async ({ where, orderBy }: { where: { sequence_id: string }; orderBy?: { step_index: 'asc' | 'desc' } }) => {
        let rows = stores.steps.filter((s) => s.sequence_id === where.sequence_id);
        if (orderBy?.step_index === 'asc') rows = [...rows].sort((a, b) => a.step_index - b.step_index);
        return rows.map((r) => ({ ...r }));
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
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
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = stores.steps.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    },
    contact: {
      findFirst: async ({ where }: { where: { id: string; user_id: string } }) => {
        const c = stores.contacts.get(where.id);
        return c && c.user_id === where.user_id ? { ...c } : null;
      },
    },
    draftMessage: {
      findFirst: async ({ where }: { where: { id: string; user_id: string } }) => {
        const d = stores.drafts.get(where.id);
        return d && d.user_id === where.user_id ? { ...d } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(stores.drafts.get(where.id)!, data);
        return {};
      },
    },
    messageThread: {
      findFirst: async ({ where }: { where: { user_id: string; contact_id: string; channel: MessageChannel } }) =>
        threads.find((t) => t.user_id === where.user_id && t.contact_id === where.contact_id && t.channel === where.channel) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const t = { id: `thread-${++threadN}`, ...(data as object) } as (typeof threads)[number];
        threads.push(t);
        return { id: t.id };
      },
      update: async () => ({}),
    },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const m = { id: `msg-${++msgN}`, created_at: new Date(), ...data } as Combined['messages'][number];
        stores.messages.push(m);
        return m;
      },
      findFirst: async () => null,
      update: async () => ({}),
    },
  };
  return { prisma: prisma as unknown as SequencePrismaClient & SendPrismaClient, stores };
}

/** Build a REAL SequenceService whose dispatcher routes EMAIL through a REAL, fully-gated
 *  EmailSendService over the combined store. `client=null` models an unconfigured RESEND_API_KEY. */
function realRunner(prisma: SequencePrismaClient & SendPrismaClient, client: InMemoryEmailSendClient | null): SequenceService {
  const emailService = new EmailSendService(prisma, {
    checkDeliverable: async (channel) => ({ channel, deliverable: true, reason: 'verified', detail: {} }),
    sendGate: makeGate(),
    emailClientFactory: () => client,
    decryptEmail: () => 'jamie@example.com',
    encryptBody: (s) => s,
  });
  const firstTouchStub = { prepareHandoff: async () => ({ status: 'NOT_FOUND' as const }) };
  const smsStub = { send: async () => ({ status: 'NOT_FOUND' as const }) };
  const dispatcher = new SeamSequenceDispatcher(firstTouchStub as never, smsStub as never, emailService);
  return new SequenceService(prisma, dispatcher, makeGate());
}

async function seedActiveEmailSequence(prisma: SequencePrismaClient): Promise<string> {
  const seq = await prisma.outreachSequence.create({
    data: { user_id: 'rep-1', contact_id: 'c-1', sequence_type: 'STANDARD', state: 'ACTIVE', current_step_index: 0 },
  });
  await prisma.outreachSequenceStep.create({
    data: {
      sequence_id: seq.id,
      step_index: 0,
      channel: MessageChannel.EMAIL,
      scheduled_at: new Date(DAYTIME.getTime() - 1000),
      status: 'SCHEDULED',
      draft_id: 'd-1',
    },
  });
  return seq.id;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Config sanity — the cron triggers ARE the missing WP05 surfaces (id/cadence are stable config)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('messaging crons — Inngest function config (package-free, no live scheduler needed)', () => {
  test('the sequence cadence tick has a stable id + hourly cron', () => {
    expect(SCHEDULED_SEQUENCE_RUN_FUNCTION_ID).toBe('messaging-scheduled-sequence-run');
    expect(SCHEDULED_SEQUENCE_RUN_CRON).toBe('0 * * * *');
  });
  test('the handoff return sweep has a stable id + hourly cron', () => {
    expect(HANDOFF_RETURN_SWEEP_FUNCTION_ID).toBe('messaging-handoff-return-sweep');
    expect(HANDOFF_RETURN_SWEEP_CRON).toBe('0 * * * *');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// runDueSequences — enumerates ACTIVE due sequences and delegates each to runDueSteps (not forked)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('runDueSequences — the cadence tick delegates to SequenceService.runDueSteps', () => {
  test('calls runDueSteps once per due sequence, with that rep+org+sending-domain context', async () => {
    const store = new InMemoryDueSequenceStore();
    store.due = [
      { sequenceId: 'seq-a', userId: 'rep-1', organizationId: ORG, sendingDomain: DOMAIN },
      { sequenceId: 'seq-b', userId: 'rep-2', organizationId: 'org-2', sendingDomain: null },
    ];
    const calls: unknown[] = [];
    const runner: SequenceRunner = {
      runDueSteps: async (userId, sequenceId, ctx) => {
        calls.push({ userId, sequenceId, ctx });
        return { sequenceId, state: 'ACTIVE', pauseReason: null, processed: 1, sent: 1, outcomes: [] };
      },
    };

    const result = await runDueSequences({ store, runner, clock: () => DAYTIME });

    expect(result.ok).toBe(true);
    expect(result.sequencesConsidered).toBe(2);
    expect(result.stepsSent).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ userId: 'rep-1', sequenceId: 'seq-a', ctx: { organizationId: ORG, sendingDomain: DOMAIN } });
    expect(calls[1]).toEqual({ userId: 'rep-2', sequenceId: 'seq-b', ctx: { organizationId: 'org-2', sendingDomain: null } });
  });

  test('fail-safe: a broken enumeration store is a graceful no-op, never a throw', async () => {
    const brokenStore = { listDueSequences: () => Promise.reject(new Error('ECONNREFUSED')) } as never;
    const runner: SequenceRunner = { runDueSteps: async () => ({ sequenceId: 'x', state: 'ACTIVE', pauseReason: null, processed: 0, sent: 0, outcomes: [] }) };
    await expect(runDueSequences({ store: brokenStore, runner })).resolves.toEqual(
      expect.objectContaining({ ok: false, skippedReason: 'infra_unavailable', stepsSent: 0 })
    );
  });

  test('fail-safe: one sequence throwing does not abort the whole tick', async () => {
    const store = new InMemoryDueSequenceStore();
    store.due = [
      { sequenceId: 'boom', userId: 'rep-1', organizationId: ORG, sendingDomain: null },
      { sequenceId: 'ok', userId: 'rep-1', organizationId: ORG, sendingDomain: null },
    ];
    const runner: SequenceRunner = {
      runDueSteps: async (_u, sequenceId) => {
        if (sequenceId === 'boom') throw new Error('transient');
        return { sequenceId, state: 'ACTIVE', pauseReason: null, processed: 1, sent: 1, outcomes: [] };
      },
    };
    const result = await runDueSequences({ store, runner });
    expect(result.ok).toBe(true);
    expect(result.stepsSent).toBe(1); // the healthy sequence still ran
    expect(result.perSequence.find((p) => p.sequenceId === 'boom')?.state).toBe('ERROR');
  });

  test('a missing runner is a loud no-op (never a silent, sends-nothing "success")', async () => {
    await expect(runDueSequences({ store: new InMemoryDueSequenceStore() } as never)).resolves.toEqual(
      expect.objectContaining({ ok: false, skippedReason: 'no_runner' })
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// NO NEW UNGATED SEND — the cron's ONLY send path is the fully-gated seam. A non-cleared EMAIL step
// dispatched via the NEW cron is HELD and the provider is NEVER called. This is the load-bearing
// gate-remediation proof: the wiring opened no ungated path.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('runDueSequences → REAL SequenceService → REAL EmailSendService: no new ungated send (§10.2/§10.5)', () => {
  test('TEETH: a NON-cleared (cfe null / PENDING) EMAIL draft is HELD by the cron; provider never called, no Message recorded', async () => {
    const { prisma, stores } = makeCombined({ draft: draftRow({ cfe_outcome: null, approval_state: 'PENDING', approved_by: null, approved_at: null }) });
    const seqId = await seedActiveEmailSequence(prisma);
    const client = new InMemoryEmailSendClient();
    const runner = realRunner(prisma, client);

    const store = new InMemoryDueSequenceStore();
    store.due = [{ sequenceId: seqId, userId: 'rep-1', organizationId: ORG, sendingDomain: DOMAIN }];

    const result = await runDueSequences({ store, runner, clock: () => DAYTIME });

    expect(result.stepsSent).toBe(0);
    expect(client.sent).toHaveLength(0); // if the wiring bypassed the seam, a real email would have gone out
    expect(stores.messages).toHaveLength(0); // nothing recorded as sent
    expect(stores.steps[0].status).toBe('HELD'); // the step is held, not sent
    expect(stores.sequences.get(seqId)!.state).toBe('PAUSED'); // the sequence paused (COMPLIANCE_BLOCK)
  });

  test('a fully-cleared, gated-OK EMAIL step DOES send through the seam (the gate is a gate, not a wall)', async () => {
    const { prisma, stores } = makeCombined(); // default draft is PASS + APPROVED
    const seqId = await seedActiveEmailSequence(prisma);
    const client = new InMemoryEmailSendClient();
    const runner = realRunner(prisma, client);

    const store = new InMemoryDueSequenceStore();
    store.due = [{ sequenceId: seqId, userId: 'rep-1', organizationId: ORG, sendingDomain: DOMAIN }];

    const result = await runDueSequences({ store, runner, clock: () => DAYTIME });

    expect(result.stepsSent).toBe(1);
    expect(client.sent).toHaveLength(1);
    expect(stores.messages[0]).toMatchObject({ channel: MessageChannel.EMAIL, sent_from: 'email_domain' });
    expect(stores.steps[0].status).toBe('SENT');
  });

  test('an unconfigured provider (RESEND_API_KEY absent) HELDs the EMAIL step — no crash, no fabricated send', async () => {
    const { prisma, stores } = makeCombined();
    const seqId = await seedActiveEmailSequence(prisma);
    const runner = realRunner(prisma, null); // null client == key-less env

    const store = new InMemoryDueSequenceStore();
    store.due = [{ sequenceId: seqId, userId: 'rep-1', organizationId: ORG, sendingDomain: DOMAIN }];

    const result = await runDueSequences({ store, runner, clock: () => DAYTIME });
    expect(result.stepsSent).toBe(0);
    expect(stores.steps[0].status).toBe('HELD');
    expect(stores.steps[0].send_hold_reason).toBe('EMAIL_UNCONFIGURED');
  });

  test('idempotent: a second tick over the same (now advanced/held) sequence never re-fires a sent step', async () => {
    const { prisma, stores } = makeCombined();
    const seqId = await seedActiveEmailSequence(prisma);
    const client = new InMemoryEmailSendClient();
    const runner = realRunner(prisma, client);
    const store = new InMemoryDueSequenceStore();
    store.due = [{ sequenceId: seqId, userId: 'rep-1', organizationId: ORG, sendingDomain: DOMAIN }];

    await runDueSequences({ store, runner, clock: () => DAYTIME });
    expect(client.sent).toHaveLength(1);
    // Second tick: the single step is now SENT and the sequence COMPLETED — nothing more to fire.
    await runDueSequences({ store, runner, clock: () => DAYTIME });
    expect(client.sent).toHaveLength(1); // NOT 2 — the sent step is never re-dispatched
    expect(stores.messages).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// runHandoffReturnSweep — returns lapsed handoffs to their rep; idempotent + ownership-scoped
// ══════════════════════════════════════════════════════════════════════════════════════════════
function makeHandoffPrisma(seed: HandoffRow[]): { prisma: ThreeWayHandoffPrismaClient; rows: HandoffRow[] } {
  const rows = seed.map((r) => ({ ...r }));
  const prisma: ThreeWayHandoffPrismaClient = {
    threeWayHandoff: {
      create: async ({ data }) => {
        const row = { id: `h-${rows.length + 1}`, ...(data as object) } as HandoffRow;
        rows.push(row);
        return { ...row };
      },
      findFirst: async ({ where }) => {
        const w = where as { id?: string; user_id?: string };
        const found = rows.find((r) => (w.id ? r.id === w.id : true) && (w.user_id ? r.user_id === w.user_id : true));
        return found ? { ...found } : null;
      },
      findMany: async () => rows.map((r) => ({ ...r })),
      update: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    },
  };
  return { prisma, rows };
}

function handoffRow(over: Partial<HandoffRow> = {}): HandoffRow {
  const invited = new Date('2026-07-14T00:00:00Z');
  return {
    id: 'h-1',
    user_id: 'rep-1',
    upline_id: 'up-1',
    organization_id: ORG,
    contact_id: 'c-1',
    thread_id: null,
    trigger_reason: 'BUYING_SIGNAL',
    state: 'INVITED',
    invited_at: invited,
    joined_at: null,
    returned_at: null,
    return_deadline_at: new Date(invited.getTime() + 24 * 60 * 60 * 1000),
    coached_next_step: null,
    ...over,
  };
}

describe('runHandoffReturnSweep — returns lapsed (24h no-join) handoffs to the rep (§10.9-8)', () => {
  const AFTER_DEADLINE = new Date('2026-07-16T00:00:01Z'); // > 24h after invited_at

  test('TEETH: a still-INVITED, past-deadline handoff is RETURNED with a coached next step', async () => {
    const { prisma, rows } = makeHandoffPrisma([handoffRow()]);
    const sweeper = new ThreeWayHandoffService(prisma);
    const store = new InMemoryLapsedHandoffStore();
    store.lapsed = [{ handoffId: 'h-1', userId: 'rep-1' }];

    const result = await runHandoffReturnSweep({ store, sweeper, clock: () => AFTER_DEADLINE });

    expect(result.ok).toBe(true);
    expect(result.returned).toBe(1);
    expect(rows[0].state).toBe('RETURNED');
    expect(rows[0].coached_next_step && rows[0].coached_next_step.length).toBeGreaterThan(0);
  });

  test('idempotent: an already-JOINED handoff is left untouched (never re-returned)', async () => {
    const { prisma, rows } = makeHandoffPrisma([handoffRow({ state: 'JOINED', joined_at: new Date('2026-07-14T06:00:00Z') })]);
    const sweeper = new ThreeWayHandoffService(prisma);
    const store = new InMemoryLapsedHandoffStore();
    store.lapsed = [{ handoffId: 'h-1', userId: 'rep-1' }];

    const result = await runHandoffReturnSweep({ store, sweeper, clock: () => AFTER_DEADLINE });
    expect(result.returned).toBe(0);
    expect(rows[0].state).toBe('JOINED'); // untouched
  });

  test('OWNERSHIP: returnIfLapsed is scoped to the owning rep — a wrong userId returns nothing', async () => {
    const { prisma, rows } = makeHandoffPrisma([handoffRow()]);
    const sweeper = new ThreeWayHandoffService(prisma);
    const store = new InMemoryLapsedHandoffStore();
    store.lapsed = [{ handoffId: 'h-1', userId: 'rep-999' }]; // not the owner

    const result = await runHandoffReturnSweep({ store, sweeper, clock: () => AFTER_DEADLINE });
    expect(result.returned).toBe(0);
    expect(rows[0].state).toBe('INVITED'); // another rep's sweep can never return it
  });

  test('fail-safe: a broken enumeration store is a graceful no-op, never a throw', async () => {
    const brokenStore = { listLapsedHandoffs: () => Promise.reject(new Error('DB down')) } as never;
    const { prisma } = makeHandoffPrisma([]);
    const sweeper = new ThreeWayHandoffService(prisma);
    await expect(runHandoffReturnSweep({ store: brokenStore, sweeper })).resolves.toEqual(
      expect.objectContaining({ ok: false, skippedReason: 'infra_unavailable' })
    );
  });
});
