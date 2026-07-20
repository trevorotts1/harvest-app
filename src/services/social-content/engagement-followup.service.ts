// T-41 (WP06 §11.5/§11.8-5 "Every scheduled post gets a companion engagement-follow-up task in
// Mission Control for the next 48 h (no post-and-forget)") — this build unit does not modify WP04's
// Mission Control zone code (src/services/mission-control/**), so the follow-up task's OWN reachable
// surface is the Content Queue's "Follow-ups" view (src/app/content/page.tsx) — a real,
// ownership-scoped, working task list, not a name-only stub referencing a screen that doesn't exist.

const FOLLOW_UP_WINDOW_HOURS = 48;

export interface EngagementFollowUpRow {
  id: string;
  user_id: string;
  content_item_id: string;
  due_at: Date;
  completed: boolean;
  completed_at: Date | null;
  created_at: Date;
}

export interface EngagementFollowUpPrismaClient {
  engagementFollowUpTask: {
    create(args: { data: Record<string, unknown> }): Promise<EngagementFollowUpRow>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, 'asc' | 'desc'>;
    }): Promise<EngagementFollowUpRow[]>;
    findFirst(args: { where: { id: string; user_id: string } }): Promise<EngagementFollowUpRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<EngagementFollowUpRow>;
  };
}

export class EngagementFollowUpService {
  constructor(private prisma: EngagementFollowUpPrismaClient) {}

  /** Called exactly once per publish (publishing.service.ts) — a 48h-out follow-up task. */
  async createFollowUp(userId: string, contentItemId: string, publishedAt: Date): Promise<EngagementFollowUpRow> {
    const dueAt = new Date(publishedAt.getTime() + FOLLOW_UP_WINDOW_HOURS * 60 * 60 * 1000);
    return this.prisma.engagementFollowUpTask.create({
      data: { user_id: userId, content_item_id: contentItemId, due_at: dueAt },
    });
  }

  async listOpen(userId: string): Promise<EngagementFollowUpRow[]> {
    return this.prisma.engagementFollowUpTask.findMany({
      where: { user_id: userId, completed: false },
      orderBy: { due_at: 'asc' },
    });
  }

  async complete(userId: string, id: string, now: Date = new Date()): Promise<EngagementFollowUpRow | null> {
    const task = await this.prisma.engagementFollowUpTask.findFirst({ where: { id, user_id: userId } });
    if (!task) return null;
    return this.prisma.engagementFollowUpTask.update({
      where: { id },
      data: { completed: true, completed_at: now },
    });
  }
}
