// T-54 (master-spec §17.6 "Offline-first & degraded operation"; uiux §6.4/§4.2) — proves Today's
// Action Queue + Team-calendar attendance offline-queue wiring (`src/app/today/offline.ts`) is real,
// not a no-op. T-51 flagged that `today/page.tsx`'s `onQueueAction` (a direct
// `fetch('/api/mission-control/queue-action')`) and `onMarkAttendance` had NO offline handling
// whatsoever — offline, the fetch simply rejected and the action was silently lost.
//
//   (a) `queueActionMutationId`/`attendanceMutationId` are stable per-item ids (dedupe-by-id);
//   (b) TEETH — `createTodayQueueHandlers` dispatches to the REAL `actOnQueueDraft` /
//       `confirmAppointment` / `markAttendance` (today.service.ts) through a fake `postJson` that
//       mirrors the real routes' exact status-code mapping, against the real in-memory
//       `MissionControlPrismaClient` fake this codebase already ships for testing
//       (`services/mission-control/testing/in-memory-db.ts`) — no live DB, no parallel gate logic;
//   (c) FAIL-CLOSED SURVIVES REPLAY: `actOnQueueDraft`'s own T-32 QC fix (a FLAG/BLOCK-banded draft
//       can never be approved) still holds when the approve is taken OFFLINE and replayed on
//       reconnect — the gate is the server function itself, never bypassed by the offline path;
//   (d) PERMANENT vs TRANSIENT replay failure — mirrors the Approval Inbox's own proof
//       (tests/unit/offline-inbox.test.ts), scoped to Today's routes;
//   (e) TEETH — replay TERMINATES against a real multi-item queue mixing both mutation kinds;
//   (f) `ActionQueue`/`CalendarStrip` render the named queued-offline state (uiux §4.2), never a
//       button that looks live but silently does nothing offline.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  attendanceMutationId,
  createTodayQueueHandlers,
  queueActionMutationId,
  TODAY_MUTATION_KIND,
  type TodayPermanentRejectionInfo,
} from '../../src/app/today/offline';
import ActionQueue from '../../src/app/today/components/ActionQueue';
import CalendarStrip from '../../src/app/today/components/CalendarStrip';
import { PersistentOfflineQueue } from '../../src/lib/offline/offline-queue';
import type { RawJsonResponse } from '../../src/lib/offline/http';
import { actOnQueueDraft, confirmAppointment, markAttendance } from '../../src/services/mission-control/today.service';
import { createInMemoryMissionControlDb } from '../../src/services/mission-control/testing/in-memory-db';
import type { MissionControlPrismaClient } from '../../src/services/mission-control/prisma-types';
import type { ActionQueueZoneData, CalendarZoneData, QueueItem } from '../../src/services/mission-control/types';
import { t as catalog, type TVars } from '../../src/lib/i18n/catalog';

const tEs = (key: string, vars?: TVars) => catalog('es', key, vars);

const render = (el: unknown, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el as never, props));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
const USER = 'rep-1';
const ORG = 'org-1';
const NOW = new Date('2026-07-15T12:00:00.000Z');

// ─── (a) Stable mutation ids ────────────────────────────────────────────────────────────────────

describe('(a) queueActionMutationId/attendanceMutationId — stable per-item ids (dedupe-by-id)', () => {
  test('same (kind, id, action) -> same id', () => {
    expect(queueActionMutationId('draft', 'd-1', 'approve')).toBe(queueActionMutationId('draft', 'd-1', 'approve'));
    expect(attendanceMutationId('evt-1')).toBe(attendanceMutationId('evt-1'));
  });
  test('approve and decline of the SAME draft never collide', () => {
    expect(queueActionMutationId('draft', 'd-1', 'approve')).not.toBe(queueActionMutationId('draft', 'd-1', 'decline'));
  });
  test('a confirm_appointment action (no action field) is distinct from a draft approve of the same id', () => {
    expect(queueActionMutationId('appointment', 'x-1')).not.toBe(queueActionMutationId('draft', 'x-1', 'approve'));
  });
});

// ─── (b)/(c)/(d) createTodayQueueHandlers against the REAL today.service functions ─────────────

/** Mirrors `src/app/api/mission-control/{queue-action,attendance}/route.ts`'s exact
 *  request/response/status-code mapping — without a live HTTP server, driving the REAL
 *  `actOnQueueDraft`/`confirmAppointment`/`markAttendance` against the real in-memory
 *  `MissionControlPrismaClient` fake. */
// T-57 RE-GATE B [af7789d3] Finding 1 residual (RGb2) — mirrors the REAL routes'
// `src/app/api/mission-control/{queue-action,attendance}/route.ts` `code` mapping (see those files'
// own RGb2 comments) so tests exercising `createTodayQueueHandlers`'s `t`-driven `errorDisplay`
// resolution are driving the same wire shape the real routes now emit, not a stale pre-fix one.
function createFakeTodayPostJson(db: MissionControlPrismaClient, organizationId: string | null = ORG) {
  return async function fakePostJson<T>(url: string, body: unknown): Promise<RawJsonResponse<T>> {
    if (url === '/api/mission-control/queue-action') {
      const { kind, id, action } = body as { kind: 'draft' | 'appointment'; id: string; action?: 'approve' | 'decline' };
      if (kind === 'appointment') {
        const result = await confirmAppointment(USER, id, db);
        if (result.ok) return { status: 200, data: { ok: true } as unknown as T };
        const code = result.reason === 'not_found' ? 'APPOINTMENT_NOT_FOUND' : 'APPOINTMENT_INVALID_STATE';
        return { status: result.reason === 'not_found' ? 404 : 409, data: { error: `appointment ${result.reason}`, code } as unknown as T };
      }
      const result = await actOnQueueDraft(USER, id, action as 'approve' | 'decline', db);
      if (result.ok) return { status: 200, data: { ok: true } as unknown as T };
      const code =
        result.reason === 'not_found'
          ? 'DRAFT_NOT_FOUND'
          : result.reason === 'invalid_state'
            ? 'QUEUE_DRAFT_INVALID_STATE'
            : 'QUEUE_DRAFT_REQUIRES_REVIEW';
      return { status: result.reason === 'not_found' ? 404 : 409, data: { error: `draft ${result.reason}`, code } as unknown as T };
    }
    if (url === '/api/mission-control/attendance') {
      const { eventId, state } = body as { eventId: string; state: 'attended' | 'missed' };
      const result = await markAttendance(USER, eventId, organizationId, state, db);
      if (result.ok) return { status: 200, data: { ok: true } as unknown as T };
      return { status: 404, data: { error: 'Event not found for your organization.', code: 'EVENT_NOT_FOUND' } as unknown as T };
    }
    throw new Error(`unexpected url in test double: ${url}`);
  };
}

function seedDraft(cfeOutcome: 'PASS' | 'FLAG' | 'BLOCK', approvalState: 'PENDING' | 'HELD') {
  return createInMemoryMissionControlDb({
    draftMessages: [
      {
        id: 'draft-1',
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
    appointments: [{ id: 'appt-1', rep_id: USER, contact_id: 'contact-1', status: 'PROPOSED', confirmed_start: null, created_at: NOW }],
    teamEvents: [{ id: 'evt-1', organization_id: ORG, type: 'team_call', starts_at: new Date(NOW.getTime() + 60 * 60 * 1000) }],
  });
}

describe('(b) createTodayQueueHandlers — replay hits the REAL today.service functions, no bypass', () => {
  test('QUEUE_ACTION replay approves a real PASS-banded draft', async () => {
    const db = seedDraft('PASS', 'PENDING');
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db));

    await handlers[TODAY_MUTATION_KIND.QUEUE_ACTION]({ kind: 'draft', id: 'draft-1', action: 'approve' });

    const row = await db.draftMessage.findFirst({ where: { id: 'draft-1', user_id: USER } });
    expect(row?.approval_state).toBe('APPROVED');
  });

  test('QUEUE_ACTION replay confirms a real PROPOSED appointment', async () => {
    const db = seedDraft('PASS', 'PENDING');
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db));

    await handlers[TODAY_MUTATION_KIND.QUEUE_ACTION]({ kind: 'appointment', id: 'appt-1' });

    const appt = await db.appointment.findFirst({ where: { id: 'appt-1', rep_id: USER } });
    expect(appt?.status).toBe('CONFIRMED');
  });

  test('ATTENDANCE replay marks real attendance for an event in the rep\'s own org', async () => {
    const db = seedDraft('PASS', 'PENDING');
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db));

    await handlers[TODAY_MUTATION_KIND.ATTENDANCE]({ eventId: 'evt-1', state: 'attended' });

    const rows = await db.attendance.findMany({ where: { event_id: { in: ['evt-1'] }, user_id: USER } });
    expect(rows[0]?.state).toBe('attended');
  });
});

describe('(c) FAIL-CLOSED SURVIVES REPLAY — a FLAG/BLOCK-banded draft approve queued offline is STILL refused on reconnect (T-32 QC fix)', () => {
  test('TEETH: a FLAG-banded draft approved OFFLINE is refused on replay — never silently APPROVED', async () => {
    const db = seedDraft('FLAG', 'PENDING');
    const rejections: TodayPermanentRejectionInfo[] = [];
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db), (info) => rejections.push(info));
    const queue = new PersistentOfflineQueue({ storageKey: 'test-today-flag' });
    queue.enqueue(TODAY_MUTATION_KIND.QUEUE_ACTION, { kind: 'draft', id: 'draft-1', action: 'approve' }, queueActionMutationId('draft', 'draft-1', 'approve'));

    const result = await queue.replay(handlers);

    expect(result).toEqual({ synced: 1, remaining: 0 }); // resolved (business-final), not retried forever
    expect(rejections).toHaveLength(1);
    const row = await db.draftMessage.findFirst({ where: { id: 'draft-1', user_id: USER } });
    expect(row?.approval_state).toBe('PENDING'); // untouched — never force-approved by the offline path
  });

  test('TEETH: a BLOCK-banded (HELD) draft approved OFFLINE is also refused on replay', async () => {
    const db = seedDraft('BLOCK', 'HELD');
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db));
    const queue = new PersistentOfflineQueue({ storageKey: 'test-today-block' });
    queue.enqueue(TODAY_MUTATION_KIND.QUEUE_ACTION, { kind: 'draft', id: 'draft-1', action: 'approve' }, queueActionMutationId('draft', 'draft-1', 'approve'));

    await queue.replay(handlers);

    const row = await db.draftMessage.findFirst({ where: { id: 'draft-1', user_id: USER } });
    expect(row?.approval_state).toBe('HELD'); // still HELD — never mutated to APPROVED
  });

  test('a clean PASS-banded draft approved offline IS approved on replay — no regression', async () => {
    const db = seedDraft('PASS', 'PENDING');
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db));
    const queue = new PersistentOfflineQueue({ storageKey: 'test-today-pass' });
    queue.enqueue(TODAY_MUTATION_KIND.QUEUE_ACTION, { kind: 'draft', id: 'draft-1', action: 'approve' }, queueActionMutationId('draft', 'draft-1', 'approve'));

    const result = await queue.replay(handlers);

    expect(result).toEqual({ synced: 1, remaining: 0 });
    const row = await db.draftMessage.findFirst({ where: { id: 'draft-1', user_id: USER } });
    expect(row?.approval_state).toBe('APPROVED');
  });
});

describe('(d) PERMANENT vs TRANSIENT replay failure', () => {
  test('a permanent rejection (event outside the org) resolves the handler, never retried forever', async () => {
    const db = seedDraft('PASS', 'PENDING');
    const rejections: TodayPermanentRejectionInfo[] = [];
    // organizationId passed to the fake postJson deliberately mismatches evt-1's own org — mirrors
    // an org-switch or stale session, a genuinely non-retryable state.
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db, 'a-different-org'), (info) => rejections.push(info));
    const queue = new PersistentOfflineQueue({ storageKey: 'test-today-permanent' });
    queue.enqueue(TODAY_MUTATION_KIND.ATTENDANCE, { eventId: 'evt-1', state: 'attended' }, attendanceMutationId('evt-1'));

    const result = await queue.replay(handlers);

    expect(result).toEqual({ synced: 1, remaining: 0 });
    expect(rejections).toHaveLength(1);
    expect(rejections[0].kind).toBe(TODAY_MUTATION_KIND.ATTENDANCE);
  });

  test('TEETH: a TRANSIENT failure (network throw) stays queued — never dropped', async () => {
    const throwingPostJson = async <T,>(): Promise<RawJsonResponse<T>> => {
      throw new Error('network error: fetch failed');
    };
    const handlers = createTodayQueueHandlers(throwingPostJson);
    const queue = new PersistentOfflineQueue({ storageKey: 'test-today-transient' });
    queue.enqueue(TODAY_MUTATION_KIND.QUEUE_ACTION, { kind: 'draft', id: 'draft-1', action: 'approve' });

    const result = await queue.replay(handlers);

    expect(result.synced).toBe(0);
    expect(result.remaining).toBe(1);
    expect(queue.length).toBe(1);
  });
});

// ─── (g) T-57 RE-GATE B [af7789d3] Finding 1 residual (RGb2) — permanent-rejection message resolves
// through code→errorDisplay, never the raw English `error` ──────────────────────────────────────

describe('(g) createTodayQueueHandlers — onPermanentRejection.message resolves via errorDisplay(t, code), never raw English', () => {
  test('RE-CONFIRMED RED then GREEN: a requires-review draft rejection carries raw English `error` on the wire, but the message surfaced to the rep is a genuine, distinct Spanish sentence when `t` is supplied', async () => {
    const db = seedDraft('FLAG', 'PENDING');
    const rejections: TodayPermanentRejectionInfo[] = [];
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db), (info) => rejections.push(info), tEs);

    await handlers[TODAY_MUTATION_KIND.QUEUE_ACTION]({ kind: 'draft', id: 'draft-1', action: 'approve' });

    expect(rejections).toHaveLength(1);
    // GREEN: never the raw `error` string the wire carries (RED, re-confirmed inline above via the
    // fake's own `data.error` shape: `draft requires_review`) and never English — a real ES sentence.
    expect(rejections[0].message).toBe(catalog('es', 'errors.QUEUE_DRAFT_REQUIRES_REVIEW'));
    expect(rejections[0].message).not.toBe('draft requires_review');
    expect(rejections[0].message).not.toMatch(/\b(draft|review|approve)\b/i);
  });

  test('an attendance permanent rejection (event outside the org) also resolves via errorDisplay — genuine Spanish, not the raw `error` prose', async () => {
    const db = seedDraft('PASS', 'PENDING');
    const rejections: TodayPermanentRejectionInfo[] = [];
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db, 'a-different-org'), (info) => rejections.push(info), tEs);

    await handlers[TODAY_MUTATION_KIND.ATTENDANCE]({ eventId: 'evt-1', state: 'attended' });

    expect(rejections).toHaveLength(1);
    expect(rejections[0].message).toBe(catalog('es', 'errors.EVENT_NOT_FOUND'));
    expect(rejections[0].message).not.toBe('Event not found for your organization.');
  });

  test('no `t` supplied (back-compat) falls back to the bare code rather than crashing or rendering English prose', async () => {
    const db = seedDraft('FLAG', 'PENDING');
    const rejections: TodayPermanentRejectionInfo[] = [];
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db), (info) => rejections.push(info));

    await handlers[TODAY_MUTATION_KIND.QUEUE_ACTION]({ kind: 'draft', id: 'draft-1', action: 'approve' });

    expect(rejections[0].message).toBe('QUEUE_DRAFT_REQUIRES_REVIEW');
  });

  test('an unknown/absent `code` still resolves to errors.generic (localized), never blank or raw English', async () => {
    const throwingPostJson = async <T,>(): Promise<RawJsonResponse<T>> => ({
      status: 400,
      data: { error: 'Some unmapped failure' } as unknown as T,
    });
    const rejections: TodayPermanentRejectionInfo[] = [];
    const handlers = createTodayQueueHandlers(throwingPostJson, (info) => rejections.push(info), tEs);

    await handlers[TODAY_MUTATION_KIND.QUEUE_ACTION]({ kind: 'draft', id: 'draft-1', action: 'approve' });

    expect(rejections[0].message).toBe(catalog('es', 'errors.generic'));
    expect(rejections[0].message).not.toBe('Some unmapped failure');
  });
});

// ─── (e) Replay TERMINATES against a real multi-kind queue ─────────────────────────────────────

describe('(e) TEETH: replay TERMINATES — drains a real mixed-kind queue, idempotent on a second call', () => {
  test('a queue-action + an attendance mark replay in FIFO order and the queue fully drains', async () => {
    const db = seedDraft('PASS', 'PENDING');
    const handlers = createTodayQueueHandlers(createFakeTodayPostJson(db));
    const queue = new PersistentOfflineQueue({ storageKey: 'test-today-drain' });

    queue.enqueue(TODAY_MUTATION_KIND.QUEUE_ACTION, { kind: 'draft', id: 'draft-1', action: 'approve' }, queueActionMutationId('draft', 'draft-1', 'approve'));
    queue.enqueue(TODAY_MUTATION_KIND.ATTENDANCE, { eventId: 'evt-1', state: 'attended' }, attendanceMutationId('evt-1'));

    const result = await queue.replay(handlers);
    expect(result).toEqual({ synced: 2, remaining: 0 });
    expect(queue.length).toBe(0);

    const draftRow = await db.draftMessage.findFirst({ where: { id: 'draft-1', user_id: USER } });
    expect(draftRow?.approval_state).toBe('APPROVED');
    const attendanceRows = await db.attendance.findMany({ where: { event_id: { in: ['evt-1'] }, user_id: USER } });
    expect(attendanceRows[0]?.state).toBe('attended');

    // TEETH: a second replay on the now-empty queue does NOTHING — no hang, no double-apply.
    const second = await queue.replay(handlers);
    expect(second).toEqual({ synced: 0, remaining: 0 });
  });
});

// ─── (f) ActionQueue / CalendarStrip — queued-offline render (uiux §4.2) ───────────────────────

describe('(f) ActionQueue renders the named queued-offline state, never a live-looking dead button', () => {
  const item: QueueItem = {
    id: 'd1',
    kind: 'approve_draft',
    title: 'Approve draft',
    why: 'because',
    contactLabel: 'Maya J.',
    minutes: 2,
    cfeBand: 'PASS',
    channel: 'SMS_HANDOFF',
  };

  test('queuedOfflineIds contains the item -> "Queued — will sync" renders, no Approve/Decline buttons for it', () => {
    const data: ActionQueueZoneData = { totalMinutes: 2, items: [item], totalCount: 1 };
    const html = render(ActionQueue, {
      result: { status: 'ok', data },
      onAction: () => {},
      queuedOfflineIds: new Set(['d1']),
    });
    expect(textOf(html)).toMatch(/Queued — will sync/);
    expect(html).not.toMatch(/<button[^>]*>\s*Approve\s*<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>\s*Decline\s*<\/button>/);
  });

  test('negative control: item NOT in queuedOfflineIds -> normal Approve/Decline buttons render (no regression)', () => {
    const data: ActionQueueZoneData = { totalMinutes: 2, items: [item], totalCount: 1 };
    const html = render(ActionQueue, { result: { status: 'ok', data }, onAction: () => {}, queuedOfflineIds: new Set() });
    expect(html).toMatch(/<button[^>]*>\s*Approve\s*<\/button>/);
    expect(textOf(html)).not.toMatch(/Queued — will sync/);
  });

  test('omitting queuedOfflineIds entirely is safe (optional prop) — no regression for existing callers', () => {
    const data: ActionQueueZoneData = { totalMinutes: 2, items: [item], totalCount: 1 };
    const html = render(ActionQueue, { result: { status: 'ok', data }, onAction: () => {} });
    expect(html).toMatch(/<button[^>]*>\s*Approve\s*<\/button>/);
  });
});

describe('(f) CalendarStrip renders the named queued-offline state for attendance marking', () => {
  const event = { id: 'evt-1', type: 'team_call', startsAt: new Date().toISOString(), attendanceState: 'none' as const };

  test('queuedOfflineEventIds contains the event -> "Queued — will sync" renders, no attendance buttons for it', () => {
    const data: CalendarZoneData = { hasOrg: true, events: [event] };
    const html = render(CalendarStrip, {
      result: { status: 'ok', data },
      onMarkAttendance: () => {},
      queuedOfflineEventIds: new Set(['evt-1']),
    });
    expect(textOf(html)).toMatch(/Queued — will sync/);
    expect(textOf(html)).not.toMatch(/I was there/);
  });

  test('negative control: event NOT queued -> normal attendance buttons render (no regression)', () => {
    const data: CalendarZoneData = { hasOrg: true, events: [event] };
    const html = render(CalendarStrip, { result: { status: 'ok', data }, onMarkAttendance: () => {} });
    expect(textOf(html)).toMatch(/I was there/);
  });
});
