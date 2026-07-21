// T-54 (master-spec §17.6 "Offline-first & degraded operation"; uiux §6.4/§4.3) — proves the
// Approval Inbox's offline-queue wiring (`src/app/inbox/offline.ts`) is real, not a no-op:
//
//   (a) `approveMutationId`/`declineMutationId` are stable per-draft ids (dedupe-by-id, mirrors the
//       ritual's own `RITUAL_MUTATION_ID` rationale);
//   (b) TEETH — `createInboxQueueHandlers` dispatches to the REAL `ApprovalInboxService`
//       (approve/decline/editDraft) through a fake `postJson` that mirrors the real
//       approve/decline/edit routes' exact status-code mapping — no live HTTP server, same
//       "in-memory fake Prisma, no live DB" convention `tests/unit/warm-market-offline.test.ts`
//       already uses for the ritual;
//   (c) ═══ THE CORE PROOF — CFE RE-VALIDATION ON RECONNECT ═══: an EDIT replayed through this
//       handler map re-enters the REAL `ComplianceFilterEngine` against the new text — a
//       now-blocked edit HOLDS on replay (never approvable), and a CFE OUTAGE at replay time (the
//       classifier throws) ALSO holds, fail-closed — proving master-spec §17.6's "never auto-send
//       offline-composed content without a fresh CFE pass; fail-closed (CFE unavailable -> HOLD)"
//       end-to-end, against the real service, not a mock;
//   (d) PERMANENT vs TRANSIENT replay failure: a business-final rejection (e.g. approving an
//       already-HELD draft) resolves the handler (removed from queue, surfaced via
//       `onPermanentRejection`) rather than retrying forever; a genuinely transient failure (network
//       throw) throws, so `PersistentOfflineQueue.replay` keeps it queued for the next attempt;
//   (e) TEETH — replay TERMINATES: draining a real multi-item inbox queue through these handlers
//       finishes (no hang), and a second replay on the now-empty queue is a true no-op — mirrors
//       `tests/unit/offline-primitive.test.ts`'s generic proof, scoped to this queue's real usage;
//   (f) `deriveQueuedDraftIds` reads the queue's own contents, not a cache that can drift;
//   (g) `ApprovalInboxItem`'s queued-offline render: no action footer, no misleading CFE-pass chip,
//       the exact uiux §4.3 banner copy.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Role } from '@prisma/client';

import {
  approveMutationId,
  createInboxQueueHandlers,
  declineMutationId,
  deriveQueuedDraftIds,
  INBOX_MUTATION_KIND,
  type PermanentRejectionInfo,
  type RawJsonResponse,
} from '../../src/app/inbox/offline';
import ApprovalInboxItem, { type InboxItemData } from '../../src/app/inbox/components/ApprovalInboxItem';
import { PersistentOfflineQueue } from '../../src/lib/offline/offline-queue';
import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import { ApprovalInboxService, type DraftMessageRow } from '../../src/services/approval-inbox/approval-inbox.service';
import { clearCFE, blockedCFE, createFakeApprovalInboxPrisma, draft } from './approval-inbox-service.test';

const render = (el: unknown, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el as never, props));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
const USER = 'u-1';

// ─── (a) Stable mutation ids ────────────────────────────────────────────────────────────────────

describe('(a) approveMutationId/declineMutationId — stable per-draft ids (dedupe-by-id)', () => {
  test('same draftId -> same id, across calls', () => {
    expect(approveMutationId('d-1')).toBe(approveMutationId('d-1'));
    expect(declineMutationId('d-1')).toBe(declineMutationId('d-1'));
  });
  test('different draftIds -> different ids; approve and decline ids for the SAME draft never collide', () => {
    expect(approveMutationId('d-1')).not.toBe(approveMutationId('d-2'));
    expect(approveMutationId('d-1')).not.toBe(declineMutationId('d-1'));
  });
});

// ─── (b)/(c)/(d) createInboxQueueHandlers against the REAL ApprovalInboxService ────────────────

/** Mirrors `src/app/api/approval-inbox/{approve,decline,edit}/route.ts`'s exact request/response/
 *  status-code mapping — without a live HTTP server, same convention
 *  `tests/unit/warm-market-offline.test.ts`'s `createFakePostJson` uses for the ritual's routes.
 *  Drives the REAL `ApprovalInboxService` passed in, so a mutation this suite claims "succeeds" or
 *  "holds" is decided by the actual service/CFE, never a parallel reimplementation. */
function createFakeInboxPostJson(service: ApprovalInboxService) {
  return async function fakePostJson<T>(url: string, body: unknown): Promise<RawJsonResponse<T>> {
    if (url === '/api/approval-inbox/approve') {
      const { draftId } = body as { draftId: string };
      const result = await service.approveDraft(USER, draftId);
      if (result.ok) return { status: 200, data: { ok: true, draft: result.draft } as unknown as T };
      if (result.reason === 'not_found') return { status: 404, data: { error: 'Draft not found' } as unknown as T };
      return {
        status: 403,
        data: { error: `not approvable (${result.currentState})`, code: 'NOT_APPROVABLE', currentState: result.currentState } as unknown as T,
      };
    }
    if (url === '/api/approval-inbox/decline') {
      const { draftId, reason, note } = body as { draftId: string; reason: string; note?: string };
      const result = await service.declineDraft(USER, draftId, reason, note ?? null);
      if (result.ok) return { status: 200, data: { ok: true, draft: result.draft } as unknown as T };
      if (result.reason === 'not_found') return { status: 404, data: { error: 'Draft not found' } as unknown as T };
      if (result.reason === 'invalid_reason') return { status: 400, data: { error: 'invalid reason' } as unknown as T };
      return { status: 409, data: { error: `not declinable (${result.currentState})`, code: 'NOT_DECLINABLE' } as unknown as T };
    }
    if (url === '/api/approval-inbox/edit') {
      const { draftId, body: newBody } = body as { draftId: string; body: string };
      const result = await service.editDraft(USER, draftId, newBody, Role.REP);
      if (result.ok) {
        return {
          status: 200,
          data: { ok: true, draft: result.draft, cfe: { band: result.verdict.band, held: result.verdict.held } } as unknown as T,
        };
      }
      if (result.reason === 'not_found') return { status: 404, data: { error: 'Draft not found' } as unknown as T };
      if (result.reason === 'empty_body') return { status: 400, data: { error: 'body cannot be empty' } as unknown as T };
      return { status: 409, data: { error: `terminal state (${result.currentState})`, code: 'TERMINAL_STATE' } as unknown as T };
    }
    throw new Error(`unexpected url in test double: ${url}`);
  };
}

describe('(b) createInboxQueueHandlers — replay hits the REAL ApprovalInboxService, no bypass', () => {
  test('APPROVE replay approves a real PENDING draft', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING' })];
    const { client, updateCalls } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());
    const handlers = createInboxQueueHandlers(createFakeInboxPostJson(service));

    await handlers[INBOX_MUTATION_KIND.APPROVE]({ draftId: 'd-1' });

    expect(updateCalls).toHaveLength(1);
    expect(rows[0].approval_state).toBe('APPROVED');
  });

  test('DECLINE replay declines a real PENDING draft with its reason', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());
    const handlers = createInboxQueueHandlers(createFakeInboxPostJson(service));

    await handlers[INBOX_MUTATION_KIND.DECLINE]({ draftId: 'd-1', reason: 'wrong_time' });

    expect(rows[0].approval_state).toBe('DECLINED');
    expect(rows[0].decline_reason).toBe('wrong_time');
  });
});

describe('(c) ═══ CORE PROOF ═══ EDIT replay RE-ENTERS THE CFE — fail-closed on reconnect (master-spec §17.6)', () => {
  test('TEETH: an offline-composed edit that is now BLOCKED holds on replay — never silently approvable', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING', cfe_outcome: 'PASS', body: 'clean original text' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const cfe = blockedCFE();
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ApprovalInboxService(client, cfe);
    const handlers = createInboxQueueHandlers(createFakeInboxPostJson(service));

    // This is the mutation the rep queued while OFFLINE, composing new text.
    await handlers[INBOX_MUTATION_KIND.EDIT]({ draftId: 'd-1', body: 'guaranteed 10k a month, no risk' });

    expect(spy).toHaveBeenCalledTimes(1); // the CFE really ran on replay — not skipped, not cached
    expect(rows[0].approval_state).toBe('HELD'); // never left PENDING/approvable
    expect(rows[0].cfe_outcome).toBe('BLOCK');
    expect(rows[0].body).toBe('guaranteed 10k a month, no risk');

    // And the now-HELD draft genuinely cannot then be approved (composes with (b)'s proof).
    const approveResult = await service.approveDraft(USER, 'd-1');
    expect(approveResult).toEqual({ ok: false, reason: 'not_approvable', currentState: 'HELD' });
  });

  test('TEETH: fail-closed — a CFE OUTAGE at replay time (classifier throws) ALSO holds the offline-composed edit', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const cfe = new ComplianceFilterEngine({
      classifierClient: { classify: async () => { throw new Error('CFE is unavailable'); } },
    });
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ApprovalInboxService(client, cfe);
    const handlers = createInboxQueueHandlers(createFakeInboxPostJson(service));

    await handlers[INBOX_MUTATION_KIND.EDIT]({ draftId: 'd-1', body: 'anything the rep typed offline' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(rows[0].approval_state).toBe('HELD'); // CFE unavailable -> HOLD, never a pass-through
  });

  test('a CLEAN offline-composed edit re-checks and lands PENDING with the fresh band (the honest opposite case)', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const cfe = clearCFE();
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ApprovalInboxService(client, cfe);
    const handlers = createInboxQueueHandlers(createFakeInboxPostJson(service));

    await handlers[INBOX_MUTATION_KIND.EDIT]({ draftId: 'd-1', body: 'a brand new clean message' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(rows[0].approval_state).toBe('PENDING');
    expect(rows[0].body).toBe('a brand new clean message');
  });
});

describe('(d) PERMANENT vs TRANSIENT replay failure — never retried forever, never silently dropped', () => {
  test('TEETH: a permanent (business-final) rejection resolves the handler — mutation is NOT retried forever', async () => {
    // The draft moved to HELD (e.g. by another action) before this queued approve could land.
    const rows = [draft({ id: 'd-1', approval_state: 'HELD', cfe_outcome: 'BLOCK' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());
    const rejections: PermanentRejectionInfo[] = [];
    const handlers = createInboxQueueHandlers(createFakeInboxPostJson(service), (info) => rejections.push(info));

    const queue = new PersistentOfflineQueue({ storageKey: 'test-inbox-permanent' });
    queue.enqueue(INBOX_MUTATION_KIND.APPROVE, { draftId: 'd-1' }, approveMutationId('d-1'));
    const result = await queue.replay(handlers);

    expect(result).toEqual({ synced: 1, remaining: 0 }); // resolved — removed from the queue
    expect(queue.length).toBe(0);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toMatchObject({ kind: INBOX_MUTATION_KIND.APPROVE, draftId: 'd-1' });
    expect(rows[0].approval_state).toBe('HELD'); // untouched — never force-approved
  });

  test('TEETH: a TRANSIENT failure (network throw) stays queued — real retry-worthy failure, not dropped', async () => {
    const throwingPostJson = async <T,>(): Promise<RawJsonResponse<T>> => {
      throw new Error('network error: fetch failed');
    };
    const handlers = createInboxQueueHandlers(throwingPostJson);
    const queue = new PersistentOfflineQueue({ storageKey: 'test-inbox-transient' });
    queue.enqueue(INBOX_MUTATION_KIND.APPROVE, { draftId: 'd-1' }, approveMutationId('d-1'));

    const result = await queue.replay(handlers);

    expect(result.synced).toBe(0);
    expect(result.remaining).toBe(1);
    expect(queue.length).toBe(1); // still queued — never dropped, never falsely marked synced
  });
});

// ─── (e) Replay TERMINATES against a real multi-item inbox queue ──────────────────────────────

describe('(e) TEETH: replay TERMINATES — drains a real multi-item queue, idempotent on a second call', () => {
  test('approve + decline + edit queued together replay in FIFO order and the queue fully drains', async () => {
    const rows = [
      draft({ id: 'd-1', approval_state: 'PENDING' }),
      draft({ id: 'd-2', approval_state: 'PENDING' }),
      draft({ id: 'd-3', approval_state: 'PENDING', body: 'original' }),
    ];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());
    const handlers = createInboxQueueHandlers(createFakeInboxPostJson(service));
    const queue = new PersistentOfflineQueue({ storageKey: 'test-inbox-drain' });

    queue.enqueue(INBOX_MUTATION_KIND.APPROVE, { draftId: 'd-1' }, approveMutationId('d-1'));
    queue.enqueue(INBOX_MUTATION_KIND.DECLINE, { draftId: 'd-2', reason: 'other' }, declineMutationId('d-2'));
    queue.enqueue(INBOX_MUTATION_KIND.EDIT, { draftId: 'd-3', body: 'edited offline' });

    const result = await queue.replay(handlers);

    expect(result).toEqual({ synced: 3, remaining: 0 });
    expect(queue.length).toBe(0);
    expect(rows[0].approval_state).toBe('APPROVED');
    expect(rows[1].approval_state).toBe('DECLINED');
    expect(rows[2].body).toBe('edited offline');

    // TEETH: a second replay on the now-empty queue does NOTHING — no hang, no double-apply.
    const second = await queue.replay(handlers);
    expect(second).toEqual({ synced: 0, remaining: 0 });
    expect(rows[0].approval_state).toBe('APPROVED'); // unchanged, not re-applied
  });
});

// ─── (f) deriveQueuedDraftIds — reads the queue's own contents ─────────────────────────────────

describe('(f) deriveQueuedDraftIds — reflects exactly what is still queued, per mutation kind', () => {
  test('collects draftIds across approve/decline/edit kinds; empty queue -> empty set', () => {
    const queue = new PersistentOfflineQueue({ storageKey: 'test-inbox-derive' });
    expect(deriveQueuedDraftIds(queue)).toEqual(new Set());

    queue.enqueue(INBOX_MUTATION_KIND.APPROVE, { draftId: 'd-1' }, approveMutationId('d-1'));
    queue.enqueue(INBOX_MUTATION_KIND.EDIT, { draftId: 'd-2', body: 'x' });
    expect(deriveQueuedDraftIds(queue)).toEqual(new Set(['d-1', 'd-2']));
  });
});

// ─── (g) ApprovalInboxItem — queued-offline render (uiux §4.3) ─────────────────────────────────

describe('(g) ApprovalInboxItem renders the named queued-offline state (uiux §4.3), never a stale action footer', () => {
  const baseItem: InboxItemData = {
    id: 'd-1',
    contact_id: 'c-1',
    contact: { firstName: 'Jordan', lastName: 'Vega' },
    channel: 'SMS_HANDOFF',
    body: 'a message',
    cfe_outcome: 'PASS',
    cfe_risk_score: 3,
    approval_state: 'PENDING',
    created_at: new Date('2026-07-18T08:00:00Z').toISOString(),
  };
  const noop = async () => ({ ok: true });

  test('queuedOffline: true -> the exact uiux §4.3 banner copy renders; no Approve/Edit/Decline buttons', () => {
    const html = render(ApprovalInboxItem, {
      item: { ...baseItem, queuedOffline: true },
      onApprove: noop,
      onDecline: noop,
      onEdit: noop,
    });
    expect(textOf(html)).toMatch(/will finish when you.{1,3}re back online; it will re-check compliance first/i);
    expect(html).not.toMatch(/<button[^>]*>\s*Approve\s*<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>\s*Decline\s*<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>\s*Edit\s*<\/button>/);
  });

  test('queuedOffline: true -> shows "Queued" in the status chip, never the stale "Pass" claim', () => {
    const html = render(ApprovalInboxItem, {
      item: { ...baseItem, queuedOffline: true, cfe_outcome: 'PASS' },
      onApprove: noop,
      onDecline: noop,
      onEdit: noop,
    });
    expect(textOf(html)).toMatch(/Queued/);
    expect(textOf(html)).not.toMatch(/Pass/);
  });

  test('negative control: queuedOffline false/absent -> the normal action footer renders (no regression)', () => {
    const html = render(ApprovalInboxItem, { item: baseItem, onApprove: noop, onDecline: noop, onEdit: noop });
    expect(html).toMatch(/<button[^>]*>\s*Approve\s*<\/button>/);
    expect(textOf(html)).not.toMatch(/will finish when you.{1,3}re back online/i);
  });
});
