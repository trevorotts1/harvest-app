// T-43 (WP07 §12.8, §12.9-8) — course progress tracking. Module completion credits the Momentum
// Score (Habit Consistency criterion, §12.1) and is a real, wired trigger (the API route that marks
// a module complete calls `recordModuleCompletion` synchronously — no separate cron needed since
// this is a direct rep action, not a passive/periodic signal).

import { COURSE_MODULES } from './course-catalog';
import type { CourseProgressRow, MomentumEventRow } from './prisma-types';

interface CourseDb {
  courseProgress: {
    findMany(args: { where: { user_id: string } }): Promise<CourseProgressRow[]>;
    upsert(args: {
      where: { user_id_module_key: { user_id: string; module_key: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<CourseProgressRow>;
  };
  momentumEvent: { create(args: { data: Omit<MomentumEventRow, 'id' | 'created_at'> }): Promise<unknown> };
}

export interface CourseModuleProgressView {
  key: string;
  order: number;
  title: string;
  summary: string;
  status: string; // NOT_STARTED | IN_PROGRESS | COMPLETED
  completedAt: string | null;
}

export async function getCourseProgress(db: Pick<CourseDb, 'courseProgress'>, userId: string): Promise<CourseModuleProgressView[]> {
  const rows = await db.courseProgress.findMany({ where: { user_id: userId } });
  const byKey = new Map(rows.map((r) => [r.module_key, r]));
  return COURSE_MODULES.map((m) => {
    const row = byKey.get(m.key);
    return {
      key: m.key,
      order: m.order,
      title: m.title,
      summary: m.summary,
      status: row?.status ?? 'NOT_STARTED',
      completedAt: row?.completed_at?.toISOString() ?? null,
    };
  }).sort((a, b) => a.order - b.order);
}

/** §12.9-8 "module completion credits the Momentum Score and triggers a celebration." Idempotent —
 *  re-completing an already-COMPLETED module does not double-credit momentum. */
export async function completeModule(db: CourseDb, userId: string, moduleKey: string, now: Date = new Date()): Promise<{ ok: boolean; alreadyCompleted: boolean }> {
  if (!COURSE_MODULES.some((m) => m.key === moduleKey)) {
    return { ok: false, alreadyCompleted: false };
  }
  const existing = await db.courseProgress.findMany({ where: { user_id: userId } });
  const already = existing.find((r) => r.module_key === moduleKey)?.status === 'COMPLETED';

  await db.courseProgress.upsert({
    where: { user_id_module_key: { user_id: userId, module_key: moduleKey } },
    create: { user_id: userId, module_key: moduleKey, status: 'COMPLETED', completed_at: now },
    update: { status: 'COMPLETED', completed_at: now },
  });

  if (!already) {
    // §12.1 "daily login + review +1" bucket (Habit Consistency) — course engagement is a habit
    // signal, same criterion mapping as daily_login_review (momentum-criteria.ts).
    await db.momentumEvent.create({ data: { user_id: userId, event_type: 'course_module_completed', points: 3, law: 'cross', source_ref: moduleKey } });
  }

  return { ok: true, alreadyCompleted: already };
}
