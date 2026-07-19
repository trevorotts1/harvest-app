// WP04 (T-32) — the aggregator's independent-zone-failure guarantee (master-spec §9.5, uiux AC-5.2-6)
// PROVEN WITH TEETH, plus the real-data mutation paths (approve/decline a draft, confirm an
// appointment, mark attendance) and their ownership checks.

import {
  actOnQueueDraft,
  buildMissionControlToday,
  confirmAppointment,
  markAttendance,
} from '../../src/services/mission-control/today.service';
import { createInMemoryMissionControlDb } from '../../src/services/mission-control/testing/in-memory-db';
import type { MissionControlPrismaClient } from '../../src/services/mission-control/prisma-types';

const USER = 'rep-1';
const ORG = 'org-1';
const NOW = new Date('2026-07-15T12:00:00.000Z');

function fullSeed() {
  return createInMemoryMissionControlDb({
    momentumEvents: [{ user_id: USER, law: 'grow', points: 10, created_at: NOW }],
    milestones: [],
    agentRuns: [
      { id: 'run-1', user_id: USER, agent_key: 'reporting', status: 'COMPLETED', reasoning_log: 'Reporting Agent composed the briefing narrative on claude-sonnet-5. CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW },
      { id: 'run-2', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'Prospecting Agent drafted a community introduction on claude-sonnet-5. CFE clear (score 3) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW },
    ],
    draftMessages: [
      { id: 'draft-1', user_id: USER, contact_id: 'contact-1', channel: 'SMS_HANDOFF', cfe_outcome: 'PASS', approval_state: 'PENDING', approved_by: null, approved_at: null, created_at: NOW },
    ],
    contacts: [
      { id: 'contact-1', user_id: USER, first_name: 'Maya', last_name: 'Johnson', pipeline_stage: 'INTRODUCED', is_client: false, updated_at: NOW, created_at: NOW },
    ],
    appointments: [
      { id: 'appt-1', rep_id: USER, contact_id: 'contact-1', status: 'PROPOSED', confirmed_start: null, created_at: NOW },
    ],
    teamEvents: [{ id: 'evt-1', organization_id: ORG, type: 'team_call', starts_at: new Date(NOW.getTime() + 60 * 60 * 1000) }],
    attendance: [],
  });
}

/** Wraps a real fake DB, replacing exactly ONE method with a synchronous throw — everything else
 *  delegates unchanged. This is the mechanism that proves a single zone's data source failing can be
 *  simulated in true isolation. */
function breakMethod<K extends keyof MissionControlPrismaClient, M extends keyof MissionControlPrismaClient[K]>(
  db: MissionControlPrismaClient,
  table: K,
  method: M
): MissionControlPrismaClient {
  return {
    ...db,
    [table]: {
      ...db[table],
      [method]: async () => {
        throw new Error(`simulated failure: ${String(table)}.${String(method)}`);
      },
    },
  };
}

describe('buildMissionControlToday — the happy path (all six zones real, not demo)', () => {
  test('every zone returns ok with real, non-fabricated data', async () => {
    const db = fullSeed();
    const today = await buildMissionControlToday(USER, { db, greetingName: 'Alex', organizationId: ORG, now: NOW });

    expect(today.header.status).toBe('ok');
    expect(today.briefing.status).toBe('ok');
    expect(today.actionQueue.status).toBe('ok');
    expect(today.pipeline.status).toBe('ok');
    expect(today.ratios.status).toBe('ok');
    expect(today.calendar.status).toBe('ok');

    if (today.header.status === 'ok') expect(today.header.data.greetingName).toBe('Alex');
    if (today.briefing.status === 'ok') expect(today.briefing.data.state).toBe('ready');
    if (today.actionQueue.status === 'ok') expect(today.actionQueue.data.totalCount).toBeGreaterThan(0);
    if (today.calendar.status === 'ok') expect(today.calendar.data.events).toHaveLength(1);
  });
});

describe('INDEPENDENT ZONE FAILURE — master-spec §9.5 / uiux AC-5.2-6, proven with teeth', () => {
  test('briefing zone data source throwing degrades ONLY briefing — the other five stay ok', async () => {
    const broken = breakMethod(fullSeed(), 'agentRun', 'findMany'); // agentRun is briefing-exclusive
    const today = await buildMissionControlToday(USER, { db: broken, greetingName: 'Alex', organizationId: ORG, now: NOW });

    expect(today.briefing.status).toBe('error');
    expect(today.header.status).toBe('ok');
    expect(today.actionQueue.status).toBe('ok');
    expect(today.pipeline.status).toBe('ok');
    expect(today.ratios.status).toBe('ok');
    expect(today.calendar.status).toBe('ok');
    // the error message is honest and safe — never leaks the raw exception/stack.
    if (today.briefing.status === 'error') {
      expect(today.briefing.message).not.toMatch(/simulated failure|Error:/);
    }
  });

  test('header zone data source throwing degrades ONLY the header — the other five stay ok', async () => {
    const broken = breakMethod(fullSeed(), 'milestone', 'findMany'); // milestone is header-exclusive
    const today = await buildMissionControlToday(USER, { db: broken, greetingName: 'Alex', organizationId: ORG, now: NOW });

    expect(today.header.status).toBe('error');
    expect(today.briefing.status).toBe('ok');
    expect(today.actionQueue.status).toBe('ok');
    expect(today.pipeline.status).toBe('ok');
    expect(today.ratios.status).toBe('ok');
    expect(today.calendar.status).toBe('ok');
  });

  test('calendar zone data source throwing degrades ONLY the calendar — the other five stay ok', async () => {
    const broken = breakMethod(fullSeed(), 'teamEvent', 'findMany'); // teamEvent is calendar-exclusive
    const today = await buildMissionControlToday(USER, { db: broken, greetingName: 'Alex', organizationId: ORG, now: NOW });

    expect(today.calendar.status).toBe('error');
    expect(today.header.status).toBe('ok');
    expect(today.briefing.status).toBe('ok');
    expect(today.actionQueue.status).toBe('ok');
    expect(today.pipeline.status).toBe('ok');
    expect(today.ratios.status).toBe('ok');
  });

  test('the aggregator call itself never rejects, even when a zone throws', async () => {
    const broken = breakMethod(fullSeed(), 'contact', 'findMany');
    await expect(
      buildMissionControlToday(USER, { db: broken, greetingName: 'Alex', organizationId: ORG, now: NOW })
    ).resolves.toBeDefined();
  });
});

describe('actOnQueueDraft — approve/decline with ownership scoping', () => {
  test('approve moves the draft to APPROVED and records a real momentum event', async () => {
    const db = fullSeed();
    const result = await actOnQueueDraft(USER, 'draft-1', 'approve', db);
    expect(result.ok).toBe(true);

    const drafts = await db.draftMessage.findMany({ where: { user_id: USER } });
    expect(drafts.find((d) => d.id === 'draft-1')?.approval_state).toBe('APPROVED');

    const events = await db.momentumEvent.findMany({ where: { user_id: USER } });
    expect(events.some((e) => e.law === 'grow')).toBe(true);
  });

  test('decline moves the draft to DECLINED', async () => {
    const db = fullSeed();
    const result = await actOnQueueDraft(USER, 'draft-1', 'decline', db);
    expect(result.ok).toBe(true);
    const drafts = await db.draftMessage.findMany({ where: { user_id: USER } });
    expect(drafts.find((d) => d.id === 'draft-1')?.approval_state).toBe('DECLINED');
  });

  test('a draft belonging to another user is refused (not_found) — never trusts the id alone', async () => {
    const db = fullSeed();
    const result = await actOnQueueDraft('someone-else', 'draft-1', 'approve', db);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('acting on an already-approved draft is refused (invalid_state)', async () => {
    const db = fullSeed();
    await actOnQueueDraft(USER, 'draft-1', 'approve', db);
    const second = await actOnQueueDraft(USER, 'draft-1', 'approve', db);
    expect(second).toEqual({ ok: false, reason: 'invalid_state' });
  });
});

// T-32 QC FIX — adversarial QC proved LIVE against shipped code that a CFE-FLAGGED or
// CFE-BLOCKED draft (content the spec says is "never sendable", master-spec §9.2/§18.6) could be
// moved to APPROVED with a single `actOnQueueDraft(user, id, 'approve')` call, because this
// function checked ONLY `approval_state`, never `cfe_outcome`. THESE TESTS FAIL against the
// pre-fix code (they must — the bug was live) and PASS once `actOnQueueDraft` also refuses
// 'approve' for any draft whose `cfe_outcome !== 'PASS'`. This is the load-bearing, defense-in-depth
// check: it must hold even if every caller/UI upstream is wrong, since it is the last gate before a
// DraftMessage becomes APPROVED.
describe('FAIL-CLOSED — actOnQueueDraft refuses to approve a FLAG or BLOCK banded draft (T-32 QC fix)', () => {
  function seedBanded(cfeOutcome: 'PASS' | 'FLAG' | 'BLOCK', approvalState: 'PENDING' | 'HELD') {
    return createInMemoryMissionControlDb({
      draftMessages: [
        {
          id: 'draft-banded',
          user_id: USER,
          contact_id: 'contact-1',
          channel: 'SMS_HANDOFF',
          cfe_outcome: cfeOutcome,
          approval_state: approvalState,
          approved_by: null,
          approved_at: null,
          created_at: NOW,
        },
      ],
      contacts: [
        { id: 'contact-1', user_id: USER, first_name: 'Maya', last_name: 'Johnson', pipeline_stage: 'INTRODUCED', is_client: false, updated_at: NOW, created_at: NOW },
      ],
    });
  }

  test('a FLAG-banded (PENDING) draft: approve is REFUSED with a distinct "requires_review" reason, not silently APPROVED', async () => {
    const db = seedBanded('FLAG', 'PENDING');
    const result = await actOnQueueDraft(USER, 'draft-banded', 'approve', db);
    expect(result).toEqual({ ok: false, reason: 'requires_review' });

    // Never mutated — still PENDING, never APPROVED, no momentum event fabricated for it.
    const drafts = await db.draftMessage.findMany({ where: { user_id: USER } });
    expect(drafts.find((d) => d.id === 'draft-banded')?.approval_state).toBe('PENDING');
    const events = await db.momentumEvent.findMany({ where: { user_id: USER } });
    expect(events.some((e) => e.law === 'grow')).toBe(false);
  });

  test('a BLOCK-banded (HELD) draft: approve is REFUSED with "requires_review", never reaches APPROVED', async () => {
    const db = seedBanded('BLOCK', 'HELD');
    const result = await actOnQueueDraft(USER, 'draft-banded', 'approve', db);
    expect(result).toEqual({ ok: false, reason: 'requires_review' });

    // Still HELD — never mutated to APPROVED.
    const held = await db.draftMessage.findFirst({ where: { id: 'draft-banded', user_id: USER } });
    expect(held?.approval_state).toBe('HELD');
    const events = await db.momentumEvent.findMany({ where: { user_id: USER } });
    expect(events.some((e) => e.law === 'grow')).toBe(false);
  });

  test('declining a FLAG-banded draft is still allowed — rejecting risky content is always safe', async () => {
    const db = seedBanded('FLAG', 'PENDING');
    const result = await actOnQueueDraft(USER, 'draft-banded', 'decline', db);
    expect(result).toEqual({ ok: true });
    const row = await db.draftMessage.findFirst({ where: { id: 'draft-banded', user_id: USER } });
    expect(row?.approval_state).toBe('DECLINED');
  });

  test('declining a BLOCK-banded (HELD) draft is still allowed', async () => {
    const db = seedBanded('BLOCK', 'HELD');
    const result = await actOnQueueDraft(USER, 'draft-banded', 'decline', db);
    expect(result).toEqual({ ok: true });
    const row = await db.draftMessage.findFirst({ where: { id: 'draft-banded', user_id: USER } });
    expect(row?.approval_state).toBe('DECLINED');
  });

  test('a clean PASS-banded draft is UNAFFECTED — still one-tap approvable as before', async () => {
    const db = seedBanded('PASS', 'PENDING');
    const result = await actOnQueueDraft(USER, 'draft-banded', 'approve', db);
    expect(result).toEqual({ ok: true });
    const row = await db.draftMessage.findFirst({ where: { id: 'draft-banded', user_id: USER } });
    expect(row?.approval_state).toBe('APPROVED');
  });
});

describe('confirmAppointment — ownership scoping + momentum', () => {
  test('confirms a PROPOSED appointment owned by the rep', async () => {
    const db = fullSeed();
    const result = await confirmAppointment(USER, 'appt-1', db);
    expect(result.ok).toBe(true);
    const appt = await db.appointment.findFirst({ where: { id: 'appt-1', rep_id: USER } });
    expect(appt?.status).toBe('CONFIRMED');
  });

  test('an appointment belonging to another rep is refused', async () => {
    const db = fullSeed();
    const result = await confirmAppointment('someone-else', 'appt-1', db);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('markAttendance — org-scoped ownership', () => {
  test('marks attendance for an event in the rep\'s own org', async () => {
    const db = fullSeed();
    const result = await markAttendance(USER, 'evt-1', ORG, 'attended', db);
    expect(result.ok).toBe(true);
    const rows = await db.attendance.findMany({ where: { event_id: { in: ['evt-1'] }, user_id: USER } });
    expect(rows[0]?.state).toBe('attended');
  });

  test('an event outside the rep\'s org is refused', async () => {
    const db = fullSeed();
    const result = await markAttendance(USER, 'evt-1', 'some-other-org', 'attended', db);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('a null organizationId (no org) is refused, never throws', async () => {
    const db = fullSeed();
    const result = await markAttendance(USER, 'evt-1', null, 'attended', db);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});
