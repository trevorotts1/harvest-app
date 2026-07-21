// T-34 (master-spec §9.7 "the two ratios") — proves LearningStateService.recomputeAndGetView reads
// real Contact/Appointment rows for ONE rep (never cross-rep), computes both ratios, PERSISTS the
// durable LearningState row (upsert), and returns the rep-facing, never-naked-number view. Uses an
// in-memory fake Prisma delegate — no live database required.

import { LearningStateService, type LearningStatePrismaClient } from '@/services/learning-state/learning-state.service';
import type { PipelineStageLike } from '@/services/learning-state/ratios';

function makeFakePrisma(opts: {
  contacts?: { id: string; user_id: string; pipeline_stage: string }[];
  appointments?: { contact_id: string; trainer_id: string | null; status: string; rep_id: string }[];
}) {
  const contacts = opts.contacts ?? [];
  const appointments = opts.appointments ?? [];
  let persisted: Record<string, unknown> | null = null;

  const prisma: LearningStatePrismaClient = {
    contact: {
      async findMany({ where }) {
        return contacts.filter((c) => c.user_id === where.user_id).map((c) => ({ id: c.id, pipeline_stage: c.pipeline_stage as PipelineStageLike }));
      },
    },
    appointment: {
      async findMany({ where }) {
        return appointments
          .filter((a) => a.rep_id === where.rep_id)
          .map((a) => ({ contact_id: a.contact_id, trainer_id: a.trainer_id, status: a.status }));
      },
    },
    learningState: {
      async upsert({ create }) {
        persisted = create;
        return {
          user_id: create.user_id as string,
          status: create.status as string,
          agent_introductions: create.agent_introductions as number,
          agent_responses: create.agent_responses as number,
          agent_appointments_set: create.agent_appointments_set as number,
          agent_confirmed_shows: create.agent_confirmed_shows as number,
          trainer_appointments_run: create.trainer_appointments_run as number,
          trainer_closes: create.trainer_closes as number,
          computed_at: new Date('2026-07-18T12:00:00Z'),
        };
      },
    },
  };

  return { prisma, getPersisted: () => persisted };
}

describe('LearningStateService.recomputeAndGetView', () => {
  test('scopes every query to ONE rep — another rep\'s contacts/appointments never leak in', async () => {
    const { prisma } = makeFakePrisma({
      contacts: [
        { id: 'c1', user_id: 'rep-1', pipeline_stage: 'INTRODUCED' },
        { id: 'c2', user_id: 'someone-else', pipeline_stage: 'CLOSED_CLIENT' },
      ],
      appointments: [{ contact_id: 'c2', trainer_id: 't1', status: 'CONFIRMED', rep_id: 'someone-else' }],
    });
    const service = new LearningStateService(prisma);
    const view = await service.recomputeAndGetView('rep-1');
    expect(view.agentRatio.status).toBe('LEARNING'); // only c1 counted -> 1 data point
    expect(view.fieldTrainerRatio.status).toBe('LEARNING'); // the other rep's appointment never counted
  });

  test('persists the computed ratios durably via upsert', async () => {
    const { prisma, getPersisted } = makeFakePrisma({
      contacts: [
        { id: 'c1', user_id: 'rep-1', pipeline_stage: 'INTRODUCED' },
        { id: 'c2', user_id: 'rep-1', pipeline_stage: 'CLOSED_CLIENT' },
      ],
      appointments: [{ contact_id: 'c2', trainer_id: 'trainer-1', status: 'CONFIRMED', rep_id: 'rep-1' }],
    });
    const service = new LearningStateService(prisma);
    await service.recomputeAndGetView('rep-1');
    const persisted = getPersisted();
    expect(persisted?.agent_introductions).toBe(2);
    expect(persisted?.trainer_appointments_run).toBe(1);
    expect(persisted?.trainer_closes).toBe(1);
    expect(persisted?.user_id).toBe('rep-1');
  });

  test('returns a computedAt timestamp and both card views, never NaN even with zero data', async () => {
    const { prisma } = makeFakePrisma({});
    const service = new LearningStateService(prisma);
    const view = await service.recomputeAndGetView('rep-empty');
    expect(view.computedAt).toBe('2026-07-18T12:00:00.000Z');
    expect(view.agentRatio.isBaseline).toBe(true);
    expect(view.fieldTrainerRatio.isBaseline).toBe(true);
    expect(view.agentRatio.headline.every((n) => Number.isFinite(n))).toBe(true);
  });
});
