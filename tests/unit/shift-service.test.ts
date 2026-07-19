// T-34 (master-spec §9.8 "The Shift", uiux §5.3) — proves the ShiftService's durable ritual
// mechanics against an in-memory fake Prisma delegate (same DI-mockable convention as
// MethodStateService's HarvestMethodPrismaClient): one card at a time, skip semantics (once ->
// end of stack, twice -> exits the Shift), the count-up timer's interrupted-resume math, the
// empty-queue Open->Close collapse (AC-5.3-9), the automatic grace-day repair, and ownership
// enforcement on card actions (a forged cardId belonging to another user's data is refused).

import {
  ShiftApprovalRequiresReviewError,
  ShiftOwnershipError,
  ShiftService,
  type AppointmentQueueRow,
  type DraftMessageQueueRow,
  type ShiftPrismaClient,
  type ShiftSessionRow,
} from '@/services/learning-state/shift.service';

function makeSessionRow(overrides: Partial<ShiftSessionRow> = {}): ShiftSessionRow {
  // Default id is derived from (user_id, session_date) — guaranteed distinct from the fake
  // prisma's own `sess-${idCounter}` create()-assigned ids, so a manually-seeded fixture row (e.g.
  // "yesterday's" session) can never collide with a row the service creates during the test.
  const seedUserId = overrides.user_id ?? 'rep-1';
  const seedSessionDate = overrides.session_date ?? '2026-07-18';
  return {
    id: overrides.id ?? `seed-${seedUserId}-${seedSessionDate}`,
    user_id: 'rep-1',
    session_date: '2026-07-18',
    mode: 'STANDARD',
    phase: 'OPEN',
    stack_position: 0,
    skip_counts: {},
    accumulated_seconds: 0,
    last_resumed_at: null,
    streak_count: 0,
    grace_day_used: false,
    reflection_text: null,
    recap_approvals: 0,
    recap_confirmations: 0,
    recap_logs: 0,
    completed_at: null,
    ...overrides,
  };
}

/** A tiny in-memory fake implementing the exact narrow `ShiftPrismaClient` surface. */
function makeFakePrisma(opts: {
  sessions?: ShiftSessionRow[];
  drafts?: DraftMessageQueueRow[];
  appointments?: AppointmentQueueRow[];
  intensity?: string;
}): ShiftPrismaClient {
  const sessions = new Map<string, ShiftSessionRow>((opts.sessions ?? []).map((s) => [`${s.user_id}::${s.session_date}`, s]));
  const drafts = new Map<string, DraftMessageQueueRow>((opts.drafts ?? []).map((d) => [d.id, d]));
  const appointments = new Map<string, AppointmentQueueRow>((opts.appointments ?? []).map((a) => [a.id, a]));
  let idCounter = 0;

  return {
    shiftSession: {
      async findUnique({ where }) {
        return sessions.get(`${where.user_id_session_date.user_id}::${where.user_id_session_date.session_date}`) ?? null;
      },
      async findMany({ where }) {
        const w = where as { user_id: string; session_date?: { gte: string } };
        return Array.from(sessions.values()).filter(
          (s) => s.user_id === w.user_id && (!w.session_date || s.session_date >= w.session_date.gte)
        );
      },
      async create({ data }) {
        idCounter += 1;
        const row = makeSessionRow({ id: `sess-${idCounter}`, ...(data as Partial<ShiftSessionRow>) });
        sessions.set(`${row.user_id}::${row.session_date}`, row);
        return row;
      },
      async update({ where, data }) {
        const existing = Array.from(sessions.values()).find((s) => s.id === where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...(data as Partial<ShiftSessionRow>) };
        sessions.set(`${updated.user_id}::${updated.session_date}`, updated);
        return updated;
      },
    },
    draftMessage: {
      async findMany({ where }) {
        const w = where as { user_id: string; approval_state: string };
        return Array.from(drafts.values()).filter((d) => d.user_id === w.user_id && d.approval_state === w.approval_state);
      },
      async findUnique({ where }) {
        return drafts.get(where.id) ?? null;
      },
      async update({ where, data }) {
        const existing = drafts.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...(data as Partial<DraftMessageQueueRow>) };
        drafts.set(where.id, updated);
        return updated;
      },
    },
    appointment: {
      async findMany({ where }) {
        const w = where as { rep_id: string; status: string };
        return Array.from(appointments.values()).filter((a) => a.rep_id === w.rep_id && a.status === w.status);
      },
      async findUnique({ where }) {
        return appointments.get(where.id) ?? null;
      },
      async update({ where, data }) {
        const existing = appointments.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...(data as Partial<AppointmentQueueRow>) };
        appointments.set(where.id, updated);
        return updated;
      },
    },
    user: {
      async findUnique() {
        return { intensity_setting: opts.intensity ?? 'MEDIUM' };
      },
    },
  };
}

function draft(id: string, overrides: Partial<DraftMessageQueueRow> = {}): DraftMessageQueueRow {
  return {
    id,
    user_id: 'rep-1',
    body: `draft ${id}`,
    channel: 'SMS_HANDOFF',
    approval_state: 'PENDING',
    cfe_outcome: 'PASS',
    created_at: new Date('2026-07-18T08:00:00Z'),
    ...overrides,
  };
}

// ─── One card at a time + skip semantics (AC-5.3-1) ───────────────────────────────────────────────

describe('ShiftService — one card at a time, skip semantics', () => {
  test('the built stack surfaces real PENDING drafts + PROPOSED appointments for THIS user only', async () => {
    const prisma = makeFakePrisma({
      drafts: [draft('d1'), draft('d2', { user_id: 'someone-else' })],
    });
    const service = new ShiftService(prisma);
    const view = await service.getOrCreateToday('rep-1');
    expect(view.stack.map((c) => c.id)).toEqual(['d1']);
  });

  test('skip once moves the item to the end of the stack (still present); skip twice removes it from the Shift', async () => {
    const prisma = makeFakePrisma({ drafts: [draft('d1'), draft('d2')] });
    const service = new ShiftService(prisma);
    await service.getOrCreateToday('rep-1');
    await service.begin('rep-1');

    let view = await service.actionCard('rep-1', 'd1', 'SKIP');
    // d1 skipped once -> moves behind d2, but is still in the stack.
    expect(view.stack.map((c) => c.id)).toEqual(['d2', 'd1']);

    view = await service.actionCard('rep-1', 'd1', 'SKIP');
    // d1 skipped twice -> leaves the Shift entirely.
    expect(view.stack.map((c) => c.id)).toEqual(['d2']);
  });

  test('APPROVE mutates the real DraftMessage (approval_state -> APPROVED) and advances the stack', async () => {
    const prisma = makeFakePrisma({ drafts: [draft('d1')] });
    const service = new ShiftService(prisma);
    await service.getOrCreateToday('rep-1');
    await service.begin('rep-1');
    const view = await service.actionCard('rep-1', 'd1', 'APPROVE');

    expect(view.stack).toEqual([]); // the only item is gone (no longer PENDING)
    expect(view.recap?.approvals).toBe(1);
    const updatedDraft = await prisma.draftMessage.findUnique({ where: { id: 'd1' } });
    expect(updatedDraft?.approval_state).toBe('APPROVED');
  });

  test('TEETH: acting on a card that belongs to another user is refused (ShiftOwnershipError), no mutation happens', async () => {
    const prisma = makeFakePrisma({ drafts: [draft('victim-draft', { user_id: 'victim' })] });
    const service = new ShiftService(prisma);
    await service.getOrCreateToday('rep-1');
    await service.begin('rep-1');

    await expect(service.actionCard('rep-1', 'victim-draft', 'APPROVE')).rejects.toBeInstanceOf(ShiftOwnershipError);
    const stillPending = await prisma.draftMessage.findUnique({ where: { id: 'victim-draft' } });
    expect(stillPending?.approval_state).toBe('PENDING');
  });
});

// ─── T-34 QC fix (D2): a flagged/blocked draft's Approve is FAIL-CLOSED at the service layer ───────
// Mirrors T-32's Mission Control fail-closed-queue-approve fix: a draft whose CFE outcome is not a
// clean PASS can never be approved through the Shift ritual's action endpoint, regardless of what
// the calling UI renders — this is the service-layer half of the defense-in-depth (the route-layer
// half is proven in tests/unit/learning-state-shift-routes.test.ts).

describe('ShiftService — T-34 QC fix (D2): FLAG/BLOCK drafts fail-closed on APPROVE', () => {
  test('TEETH: APPROVE on a FLAG draft is refused (ShiftApprovalRequiresReviewError) — no mutation, no recap credit', async () => {
    const prisma = makeFakePrisma({ drafts: [draft('flagged-1', { cfe_outcome: 'FLAG' })] });
    const service = new ShiftService(prisma);
    await service.getOrCreateToday('rep-1');
    await service.begin('rep-1');

    await expect(service.actionCard('rep-1', 'flagged-1', 'APPROVE')).rejects.toBeInstanceOf(
      ShiftApprovalRequiresReviewError
    );
    const stillPending = await prisma.draftMessage.findUnique({ where: { id: 'flagged-1' } });
    expect(stillPending?.approval_state).toBe('PENDING');
    const view = await service.getOrCreateToday('rep-1');
    expect(view.recap?.approvals ?? 0).toBe(0);
  });

  test('TEETH: APPROVE on a BLOCK draft is refused (ShiftApprovalRequiresReviewError) — no mutation', async () => {
    const prisma = makeFakePrisma({ drafts: [draft('blocked-1', { cfe_outcome: 'BLOCK' })] });
    const service = new ShiftService(prisma);
    await service.getOrCreateToday('rep-1');
    await service.begin('rep-1');

    await expect(service.actionCard('rep-1', 'blocked-1', 'APPROVE')).rejects.toBeInstanceOf(
      ShiftApprovalRequiresReviewError
    );
    const stillPending = await prisma.draftMessage.findUnique({ where: { id: 'blocked-1' } });
    expect(stillPending?.approval_state).toBe('PENDING');
  });

  test('a clean PASS draft is still one-tap approvable — the fail-closed check never blocks the common case', async () => {
    const prisma = makeFakePrisma({ drafts: [draft('clean-1', { cfe_outcome: 'PASS' })] });
    const service = new ShiftService(prisma);
    await service.getOrCreateToday('rep-1');
    await service.begin('rep-1');

    const view = await service.actionCard('rep-1', 'clean-1', 'APPROVE');
    expect(view.recap?.approvals).toBe(1);
    const updated = await prisma.draftMessage.findUnique({ where: { id: 'clean-1' } });
    expect(updated?.approval_state).toBe('APPROVED');
  });

  test('DECLINE on a FLAG/BLOCK draft is NEVER gated — rejecting risky content is always allowed', async () => {
    const prisma = makeFakePrisma({
      drafts: [draft('flagged-2', { cfe_outcome: 'FLAG' }), draft('blocked-2', { cfe_outcome: 'BLOCK' })],
    });
    const service = new ShiftService(prisma);
    await service.getOrCreateToday('rep-1');
    await service.begin('rep-1');

    await service.actionCard('rep-1', 'flagged-2', 'DECLINE');
    await service.actionCard('rep-1', 'blocked-2', 'DECLINE');
    const d1 = await prisma.draftMessage.findUnique({ where: { id: 'flagged-2' } });
    const d2 = await prisma.draftMessage.findUnique({ where: { id: 'blocked-2' } });
    expect(d1?.approval_state).toBe('DECLINED');
    expect(d2?.approval_state).toBe('DECLINED');
  });

  test('the built stack carries the real cfeOutcome + RESPOND_FLAGGED type for FLAG/BLOCK drafts (what WorkPhase gates its UI on)', async () => {
    const prisma = makeFakePrisma({
      drafts: [draft('flagged-3', { cfe_outcome: 'FLAG' }), draft('clean-3', { cfe_outcome: 'PASS' })],
    });
    const service = new ShiftService(prisma);
    const view = await service.getOrCreateToday('rep-1');
    const flaggedCard = view.stack.find((c) => c.id === 'flagged-3');
    const cleanCard = view.stack.find((c) => c.id === 'clean-3');
    expect(flaggedCard?.type).toBe('RESPOND_FLAGGED');
    expect(flaggedCard?.cfeOutcome).toBe('FLAG');
    expect(cleanCard?.type).toBe('APPROVE_DRAFT');
    expect(cleanCard?.cfeOutcome).toBe('PASS');
  });
});

// ─── Empty queue still collapses Open -> Close and increments the streak (AC-5.3-9) ────────────────

describe('ShiftService — empty queue', () => {
  test('an empty real queue collapses begin() straight to CLOSE, never lingering on an empty Work phase', async () => {
    const prisma = makeFakePrisma({});
    const service = new ShiftService(prisma);
    await service.getOrCreateToday('rep-1');
    const view = await service.begin('rep-1');
    expect(view.phase).toBe('CLOSE');
    expect(view.isEmpty).toBe(true);
  });

  test('closing an empty-queue day still increments the streak', async () => {
    const prisma = makeFakePrisma({});
    const service = new ShiftService(prisma);
    await service.getOrCreateToday('rep-1');
    await service.begin('rep-1');
    const view = await service.close('rep-1');
    expect(view.phase).toBe('DONE');
    expect(view.streakCount).toBe(1);
  });
});

// ─── Short mode caps at 3 (AC-5.3-4) ───────────────────────────────────────────────────────────────

describe('ShiftService — short mode', () => {
  test('SHORT mode caps the stack at 3 items even with more real PENDING drafts available', async () => {
    const prisma = makeFakePrisma({ drafts: [draft('d1'), draft('d2'), draft('d3'), draft('d4'), draft('d5')] });
    const service = new ShiftService(prisma);
    const view = await service.getOrCreateToday('rep-1', 'SHORT');
    expect(view.stack.length).toBe(3);
    expect(view.targetSeconds).toBe(600);
  });
});

// ─── Interrupted-shift resume (AC-5.3-7) ───────────────────────────────────────────────────────────

describe('ShiftService — interrupted resume', () => {
  test('elapsed time accumulates across a resumed WORK session (accumulated_seconds + live diff)', async () => {
    const resumedAt = new Date('2026-07-18T10:00:00Z');
    const now = new Date('2026-07-18T10:05:00Z'); // 5 minutes later
    const prisma = makeFakePrisma({
      sessions: [makeSessionRow({ phase: 'WORK', accumulated_seconds: 120, last_resumed_at: resumedAt })],
      drafts: [draft('d1')],
    });
    const service = new ShiftService(prisma, () => now);
    const view = await service.getOrCreateToday('rep-1');
    expect(view.elapsedSeconds).toBe(120 + 300); // 120 frozen + 300 live seconds
  });
});

// ─── Automatic grace-day repair (AC-5.3-6) ────────────────────────────────────────────────────────

describe('ShiftService — grace day', () => {
  test('a broken streak at Low intensity, with a grace day still available this week, is automatically repaired (no ask)', async () => {
    const prisma = makeFakePrisma({
      sessions: [
        makeSessionRow({ user_id: 'rep-1', session_date: '2026-07-17', phase: 'WORK', streak_count: 4 }), // yesterday NOT done
      ],
      intensity: 'LOW',
    });
    const service = new ShiftService(prisma, () => new Date('2026-07-18T09:00:00Z'));
    await service.getOrCreateToday('rep-1');
    const opened = await service.getOrCreateToday('rep-1');
    expect(opened.graceDayOffer).toBe(true); // surfaced automatically on Open

    await service.begin('rep-1');
    const closed = await service.close('rep-1');
    expect(closed.graceDayUsed).toBe(true);
    expect(closed.streakCount).toBe(5); // repaired, not reset to 1
  });

  test('a broken streak at MEDIUM intensity (no grace day) resets the streak to 1', async () => {
    const prisma = makeFakePrisma({
      sessions: [makeSessionRow({ user_id: 'rep-1', session_date: '2026-07-17', phase: 'WORK', streak_count: 4 })],
      intensity: 'MEDIUM',
    });
    const service = new ShiftService(prisma, () => new Date('2026-07-18T09:00:00Z'));
    await service.getOrCreateToday('rep-1');
    const opened = await service.getOrCreateToday('rep-1');
    expect(opened.graceDayOffer).toBe(false);

    await service.begin('rep-1');
    const closed = await service.close('rep-1');
    expect(closed.graceDayUsed).toBe(false);
    expect(closed.streakCount).toBe(1);
  });

  test('a completed prior day simply increments the streak', async () => {
    const prisma = makeFakePrisma({
      sessions: [makeSessionRow({ user_id: 'rep-1', session_date: '2026-07-17', phase: 'DONE', streak_count: 4 })],
    });
    const service = new ShiftService(prisma, () => new Date('2026-07-18T09:00:00Z'));
    await service.getOrCreateToday('rep-1');
    await service.begin('rep-1');
    const closed = await service.close('rep-1');
    expect(closed.streakCount).toBe(5);
  });
});

// ─── Reflection is optional, equal-weight (AC-5.3-5) ───────────────────────────────────────────────

describe('ShiftService — optional reflection', () => {
  test('close() with no reflectionText succeeds identically to close() with one', async () => {
    const prisma = makeFakePrisma({});
    const service = new ShiftService(prisma);
    await service.getOrCreateToday('rep-1');
    await service.begin('rep-1');
    const view = await service.close('rep-1');
    expect(view.reflectionText).toBeNull();
    expect(view.phase).toBe('DONE');
  });
});
