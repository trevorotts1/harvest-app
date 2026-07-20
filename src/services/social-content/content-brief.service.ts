// T-41 (WP06 §11.1 "drafts generated ... from a weekly content brief with context from WP02 new
// contacts/signals, Mission Control priorities, and WP09 upcoming events") — assembles a lightweight,
// PII-free context snapshot for one rep's weekly batch. Deliberately carries NO contact names/PII —
// only counts and org-scoped event titles/times (deny-by-default, §0.4 rule 4: cross-org data never
// leaks, and this snapshot is persisted in ContentBrief.context as plain JSON, so it must not carry
// anything the encryption/PII surface (Contact.first_name/last_name/phone/email/notes) protects).

export interface ContentBriefContext {
  newContactsLast7Days: number;
  upcomingEvents: { type: string; startsAt: string }[];
}

export interface ContentBriefPrismaClient {
  contact: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  teamEvent: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, 'asc' | 'desc'>;
      take?: number;
    }): Promise<{ type: string; starts_at: Date }[]>;
  };
  user: {
    findUnique(args: { where: { id: string }; select: Record<string, boolean> }): Promise<{
      organization_id: string | null;
      anchor_statement: string | null;
      name: string;
    } | null>;
  };
  contentBrief: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; user_id: string; week_start: Date; context: unknown; crosswalk: string | null; created_at: Date }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface RepBriefingIdentity {
  firstName: string;
  anchorStatement: string | null;
  organizationId: string | null;
}

export class ContentBriefService {
  constructor(private prisma: ContentBriefPrismaClient) {}

  async loadRepIdentity(userId: string): Promise<RepBriefingIdentity> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { organization_id: true, anchor_statement: true, name: true },
    });
    const firstName = (user?.name ?? 'there').split(' ')[0];
    return {
      firstName,
      anchorStatement: user?.anchor_statement ?? null,
      organizationId: user?.organization_id ?? null,
    };
  }

  async buildContext(userId: string, organizationId: string | null, now: Date): Promise<ContentBriefContext> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const newContactsLast7Days = await this.prisma.contact.count({
      where: { user_id: userId, created_at: { gte: sevenDaysAgo } },
    });
    const upcomingEventRows = organizationId
      ? await this.prisma.teamEvent.findMany({
          where: { organization_id: organizationId, starts_at: { gte: now } },
          orderBy: { starts_at: 'asc' },
          take: 3,
        })
      : [];
    return {
      newContactsLast7Days,
      upcomingEvents: upcomingEventRows.map((e) => ({ type: e.type, startsAt: e.starts_at.toISOString() })),
    };
  }

  /** Plain-language context note fed into generation prompts — never raw contact PII. */
  contextNote(context: ContentBriefContext): string {
    const parts: string[] = [];
    if (context.newContactsLast7Days > 0) {
      parts.push(`${context.newContactsLast7Days} new community connection(s) this week`);
    }
    if (context.upcomingEvents.length > 0) {
      parts.push(`an upcoming ${context.upcomingEvents[0].type.replace(/_/g, ' ')}`);
    }
    return parts.join('; ');
  }

  async createBrief(userId: string, weekStart: Date, context: ContentBriefContext) {
    return this.prisma.contentBrief.create({
      data: { user_id: userId, week_start: weekStart, context: context as unknown as object },
    });
  }

  async setCrosswalk(briefId: string, crosswalk: string): Promise<void> {
    await this.prisma.contentBrief.update({ where: { id: briefId }, data: { crosswalk } });
  }
}
