// T-41 — the package-free scheduled-job handlers (§11.1 weekly batch sweep, §11.5 publish tick,
// §11.4 launch-kit auto-trigger sweep). Fail-safe proofs: one unit's failure never blocks the rest.

import {
  runLaunchKitAutoTriggerSweep,
  runPublishTick,
  runWeeklyBatchSweep,
  type LaunchKitSweepPrismaClient,
  type PublishTickPrismaClient,
  type WeeklyBatchSweepPrismaClient,
} from './scheduled-jobs';
import type { ContentBatchService } from './content-batch.service';
import type { LaunchKitService } from './launch-kit.service';
import type { PublishingService } from './publishing.service';
import type { ContentItemRow } from './content-item.service';

describe('runWeeklyBatchSweep — one rep per UTC week, fail-safe', () => {
  test('generates a batch for reps without a brief this week, and skips reps who already have one', async () => {
    const db: WeeklyBatchSweepPrismaClient = {
      user: { async findMany() { return [{ id: 'rep-1' }, { id: 'rep-2' }]; } },
      contentBrief: {
        async findFirst({ where }) {
          return where.user_id === 'rep-2' ? { id: 'existing' } : null;
        },
      },
    };
    const generate = jest.fn().mockResolvedValue({ briefId: 'b', items: [], crosswalk: '' });
    const batchService = { generateWeeklyBatch: generate } as unknown as ContentBatchService;

    const result = await runWeeklyBatchSweep(db, batchService, new Date('2026-07-20T09:00:00Z'));
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith('rep-1', expect.any(Date));
  });

  test('one rep\'s generation failure does not block the sweep, and is recorded', async () => {
    const db: WeeklyBatchSweepPrismaClient = {
      user: { async findMany() { return [{ id: 'rep-1' }, { id: 'rep-2' }]; } },
      contentBrief: { async findFirst() { return null; } },
    };
    const generate = jest.fn().mockImplementation(async (userId: string) => {
      if (userId === 'rep-1') throw new Error('Claude unavailable');
      return { briefId: 'b', items: [], crosswalk: '' };
    });
    const batchService = { generateWeeklyBatch: generate } as unknown as ContentBatchService;

    const result = await runWeeklyBatchSweep(db, batchService, new Date('2026-07-20T09:00:00Z'));
    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toEqual([{ userId: 'rep-1', error: 'Claude unavailable' }]);
  });
});

describe('runPublishTick — delegates due items to PublishingService.runDuePublishes', () => {
  test('passes exactly the due (scheduled_for <= now, SCHEDULED) rows through', async () => {
    const dueRows = [{ id: 'i-1' } as ContentItemRow];
    const db: PublishTickPrismaClient = { contentItem: { async findMany() { return dueRows; } } };
    const runDuePublishes = jest.fn().mockResolvedValue([{ status: 'PUBLISHED' }]);
    const publishingService = { runDuePublishes } as unknown as PublishingService;

    const results = await runPublishTick(db, publishingService, new Date());
    expect(runDuePublishes).toHaveBeenCalledWith(dueRows, expect.any(Date));
    expect(results).toEqual([{ status: 'PUBLISHED' }]);
  });
});

describe('runLaunchKitAutoTriggerSweep — §11.4 "Triggered on a new member joining"', () => {
  test('triggers a kit for a CLOSED_RECRUIT contact with no existing kit, skips one that already has a kit', async () => {
    const db: LaunchKitSweepPrismaClient = {
      contact: {
        async findMany() {
          return [
            { id: 'c-1', user_id: 'rep-1', first_name: 'Riley' },
            { id: 'c-2', user_id: 'rep-1', first_name: 'Sam' },
          ];
        },
      },
      launchKit: { async findMany() { return [{ new_member_contact_id: 'c-2' }]; } },
    };
    const triggerKit = jest.fn().mockResolvedValue({ kit: { id: 'kit-1' }, items: [], wholeKitHeld: false });
    const launchKitService = { triggerKit } as unknown as LaunchKitService;

    const result = await runLaunchKitAutoTriggerSweep(db, launchKitService, new Date());
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(triggerKit).toHaveBeenCalledTimes(1);
    expect(triggerKit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'rep-1', newMemberContactId: 'c-1', newMemberFirstName: 'Riley' }),
      expect.any(Date)
    );
  });

  test('one contact\'s failure does not block the rest of the sweep', async () => {
    const db: LaunchKitSweepPrismaClient = {
      contact: {
        async findMany() {
          return [
            { id: 'c-1', user_id: 'rep-1', first_name: 'Riley' },
            { id: 'c-2', user_id: 'rep-2', first_name: 'Sam' },
          ];
        },
      },
      launchKit: { async findMany() { return []; } },
    };
    const triggerKit = jest.fn().mockImplementation(async (input: { newMemberContactId: string }) => {
      if (input.newMemberContactId === 'c-1') throw new Error('boom');
      return { kit: { id: 'kit-2' }, items: [], wholeKitHeld: false };
    });
    const launchKitService = { triggerKit } as unknown as LaunchKitService;

    const result = await runLaunchKitAutoTriggerSweep(db, launchKitService, new Date());
    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toEqual([{ contactId: 'c-1', error: 'boom' }]);
  });
});
