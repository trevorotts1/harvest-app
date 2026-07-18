// WP04 (T-32) — an in-memory fake of `MissionControlPrismaClient`, for tests only (never imported by
// any route or by today.service.ts's default path). Same convention as
// `InMemoryAgentRuntimeStore` (agent-runtime/store.ts): a small, real, DI-mockable implementation of
// the narrow Prisma interface — no jest.mock magic, no real DB, no real Prisma import at all.

import type {
  AgentRunRow,
  AppointmentRow,
  AttendanceRow,
  ContactRow,
  DraftMessageRow,
  MilestoneRow,
  MissionControlPrismaClient,
  MomentumEventRow,
  TeamEventRow,
} from '../prisma-types';

interface SeededMomentumEvent extends MomentumEventRow {
  user_id: string;
}
interface SeededMilestone extends MilestoneRow {
  user_id: string;
}
interface SeededAgentRun extends AgentRunRow {
  user_id: string;
}

export interface InMemoryMissionControlSeed {
  momentumEvents?: SeededMomentumEvent[];
  milestones?: SeededMilestone[];
  agentRuns?: SeededAgentRun[];
  draftMessages?: DraftMessageRow[];
  contacts?: (ContactRow & { user_id: string })[];
  appointments?: AppointmentRow[];
  teamEvents?: TeamEventRow[];
  attendance?: AttendanceRow[];
}

/** Builds a fully working in-memory `MissionControlPrismaClient`. Every method reads/writes the
 *  seeded arrays directly (mutations from actOnQueueDraft/confirmAppointment/markAttendance/
 *  recordMomentumEvent are visible on subsequent calls), which is what lets tests assert real
 *  end-to-end behavior without a database — including that every read is correctly scoped to the
 *  requesting user, never returning another user's rows. */
export function createInMemoryMissionControlDb(seed: InMemoryMissionControlSeed = {}): MissionControlPrismaClient {
  const momentumEvents = [...(seed.momentumEvents ?? [])];
  const milestones = [...(seed.milestones ?? [])];
  const agentRuns = [...(seed.agentRuns ?? [])];
  const draftMessages = [...(seed.draftMessages ?? [])];
  const contacts = [...(seed.contacts ?? [])];
  const appointments = [...(seed.appointments ?? [])];
  const teamEvents = [...(seed.teamEvents ?? [])];
  const attendance = [...(seed.attendance ?? [])];

  return {
    momentumEvent: {
      async findMany({ where }) {
        return momentumEvents.filter((e) => e.user_id === where.user_id);
      },
      async create({ data }) {
        const id = `mom-${momentumEvents.length + 1}`;
        momentumEvents.push({
          user_id: data.user_id,
          law: data.law,
          points: data.points,
          created_at: new Date(),
        });
        return { id };
      },
    },
    milestone: {
      async findMany({ where }) {
        return milestones.filter((m) => m.user_id === where.user_id);
      },
    },
    agentRun: {
      async findMany({ where, take }) {
        let rows = agentRuns.filter((r) => r.user_id === where.user_id && (where.agent_key ? r.agent_key === where.agent_key : true));
        rows = [...rows].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
        return typeof take === 'number' ? rows.slice(0, take) : rows;
      },
    },
    draftMessage: {
      async findMany({ where }) {
        const states = where.approval_state
          ? typeof where.approval_state === 'string'
            ? [where.approval_state]
            : where.approval_state.in
          : null;
        return draftMessages.filter((d) => d.user_id === where.user_id && (states ? states.includes(d.approval_state) : true));
      },
      async findFirst({ where }) {
        return draftMessages.find((d) => d.id === where.id && d.user_id === where.user_id) ?? null;
      },
      async update({ where, data }) {
        const row = draftMessages.find((d) => d.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    },
    contact: {
      async findMany({ where }) {
        return contacts.filter((c) => c.user_id === where.user_id && (where.id ? where.id.in.includes(c.id) : true));
      },
    },
    appointment: {
      async findMany({ where }) {
        return appointments.filter((a) => a.rep_id === where.rep_id && (where.status ? a.status === where.status : true));
      },
      async findFirst({ where }) {
        return appointments.find((a) => a.id === where.id && a.rep_id === where.rep_id) ?? null;
      },
      async update({ where, data }) {
        const row = appointments.find((a) => a.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    },
    teamEvent: {
      async findMany({ where, take }) {
        return teamEvents
          .filter((e) => e.organization_id === where.organization_id && e.starts_at.getTime() >= where.starts_at.gte.getTime())
          .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime())
          .slice(0, take);
      },
      async findFirst({ where }) {
        return teamEvents.find((e) => e.id === where.id && e.organization_id === where.organization_id) ?? null;
      },
    },
    attendance: {
      async findMany({ where }) {
        return attendance.filter((a) => where.event_id.in.includes(a.event_id) && a.user_id === where.user_id);
      },
      async upsert({ where, create, update }) {
        const existing = attendance.find(
          (a) => a.event_id === where.event_id_user_id.event_id && a.user_id === where.event_id_user_id.user_id
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: AttendanceRow = { id: `att-${attendance.length + 1}`, event_id: create.event_id, user_id: create.user_id, state: create.state };
        attendance.push(row);
        return row;
      },
    },
  };
}
