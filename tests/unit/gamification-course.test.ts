// T-43 (WP07 §12.8, §12.9-8) — course progress: module completion credits the Momentum Score exactly
// once (idempotent), and the catalog is real, ordered, complete content (not an empty stub).

import { completeModule, getCourseProgress } from '../../src/services/gamification/course.service';
import { COURSE_MODULES } from '../../src/services/gamification/course-catalog';

function makeDb() {
  const progress = new Map<string, { user_id: string; module_key: string; status: string; completed_at: Date | null }>();
  const events: unknown[] = [];
  return {
    events,
    db: {
      courseProgress: {
        findMany: async ({ where }: { where: { user_id: string } }) =>
          [...progress.values()].filter((p) => p.user_id === where.user_id),
        upsert: async ({ where, create, update }: { where: { user_id_module_key: { user_id: string; module_key: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const key = `${where.user_id_module_key.user_id}:${where.user_id_module_key.module_key}`;
          const existing = progress.get(key);
          const row = existing ? { ...existing, ...update } : { ...create };
          progress.set(key, row as never);
          return row as never;
        },
      },
      momentumEvent: { create: async ({ data }: { data: unknown }) => { events.push(data); return {}; } },
    },
  };
}

describe('COURSE_MODULES — real, complete, disclosed v1 content (Category 4: not a stub)', () => {
  test('at least five modules, each with a substantive body', () => {
    expect(COURSE_MODULES.length).toBeGreaterThanOrEqual(5);
    for (const m of COURSE_MODULES) {
      expect(m.body.length).toBeGreaterThan(200);
      expect(m.title.length).toBeGreaterThan(0);
    }
  });

  test('modules are uniquely keyed and orderable', () => {
    const keys = new Set(COURSE_MODULES.map((m) => m.key));
    expect(keys.size).toBe(COURSE_MODULES.length);
  });
});

describe('completeModule — credits Momentum exactly once (idempotent, §12.9-8)', () => {
  test('first completion records a MomentumEvent', async () => {
    const { db, events } = makeDb();
    const result = await completeModule(db, 'rep-1', COURSE_MODULES[0].key);
    expect(result.ok).toBe(true);
    expect(result.alreadyCompleted).toBe(false);
    expect(events).toHaveLength(1);
  });

  test('completing the same module again does NOT double-credit momentum', async () => {
    const { db, events } = makeDb();
    await completeModule(db, 'rep-1', COURSE_MODULES[0].key);
    const second = await completeModule(db, 'rep-1', COURSE_MODULES[0].key);
    expect(second.alreadyCompleted).toBe(true);
    expect(events).toHaveLength(1);
  });

  test('an unknown module key is rejected', async () => {
    const { db } = makeDb();
    const result = await completeModule(db, 'rep-1', 'not_a_real_module');
    expect(result.ok).toBe(false);
  });
});

describe('getCourseProgress — every module listed, in order, with real status', () => {
  test('all modules NOT_STARTED before any completion', async () => {
    const { db } = makeDb();
    const progress = await getCourseProgress(db, 'rep-1');
    expect(progress).toHaveLength(COURSE_MODULES.length);
    expect(progress.every((p) => p.status === 'NOT_STARTED')).toBe(true);
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i].order).toBeGreaterThan(progress[i - 1].order);
    }
  });

  test('a completed module reports COMPLETED with a timestamp', async () => {
    const { db } = makeDb();
    await completeModule(db, 'rep-1', COURSE_MODULES[0].key);
    const progress = await getCourseProgress(db, 'rep-1');
    const first = progress.find((p) => p.key === COURSE_MODULES[0].key)!;
    expect(first.status).toBe('COMPLETED');
    expect(first.completedAt).not.toBeNull();
  });
});
