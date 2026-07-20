import { EngagementFollowUpService, type EngagementFollowUpPrismaClient, type EngagementFollowUpRow } from './engagement-followup.service';

function makeFakeDb() {
  const rows: EngagementFollowUpRow[] = [];
  let n = 0;
  const client: EngagementFollowUpPrismaClient = {
    engagementFollowUpTask: {
      async create({ data }) {
        const row = { id: `f-${++n}`, completed: false, completed_at: null, created_at: new Date(), ...data } as EngagementFollowUpRow;
        rows.push(row);
        return row;
      },
      async findMany({ where }) {
        return rows.filter((r) => r.user_id === where.user_id && (where.completed === undefined || r.completed === where.completed));
      },
      async findFirst({ where }) {
        return rows.find((r) => r.id === where.id && r.user_id === where.user_id) ?? null;
      },
      async update({ where, data }) {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  };
  return { client, rows };
}

describe('EngagementFollowUpService — §11.8-5 "no post-and-forget"', () => {
  test('createFollowUp sets due_at exactly 48h after publish', async () => {
    const { client } = makeFakeDb();
    const service = new EngagementFollowUpService(client);
    const publishedAt = new Date('2026-07-20T10:00:00Z');
    const task = await service.createFollowUp('u-1', 'item-1', publishedAt);
    expect(task.due_at.getTime() - publishedAt.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  test('listOpen returns only this user\'s incomplete tasks', async () => {
    const { client } = makeFakeDb();
    const service = new EngagementFollowUpService(client);
    await service.createFollowUp('u-1', 'item-1', new Date());
    await service.createFollowUp('u-2', 'item-2', new Date());
    const open = await service.listOpen('u-1');
    expect(open).toHaveLength(1);
    expect(open[0].content_item_id).toBe('item-1');
  });

  test('complete marks the task done and is ownership-scoped', async () => {
    const { client } = makeFakeDb();
    const service = new EngagementFollowUpService(client);
    const task = await service.createFollowUp('u-1', 'item-1', new Date());
    const wrongUser = await service.complete('u-2', task.id);
    expect(wrongUser).toBeNull();
    const completed = await service.complete('u-1', task.id);
    expect(completed?.completed).toBe(true);
  });
});
