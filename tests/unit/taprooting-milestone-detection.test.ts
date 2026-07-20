// WP08 §13.4 — milestone detection "at the moment of completion": recruit/leg/team/leader events,
// the phase-timeline auto-items with a real existing signal, and stagnation flagging. Wired to two
// real production callers (the `/api/taprooting/tree` GET route, and the daily Inngest sweep,
// `sweep.ts`) — proven here at the service level.

import { OrgType } from '@prisma/client';

import { InMemoryLicensingRepository } from '../../src/services/compliance/licensing/licensing-repository';
import { LicensingService } from '../../src/services/compliance/licensing/licensing-service';
import { runMilestoneDetection, type MilestoneDetectionPrismaClient } from '../../src/services/taprooting/milestone-detection.service';

interface Row {
  users: { id: string; name: string; rank: string | null; org_type: OrgType }[];
  edges: { id: string; sponsor_id: string; recruit_id: string }[];
  milestoneKeys: Set<string>;
  harvestMethodCompletedAt: Date | null;
  firstSendAt: Date | null;
  hasIntensitySession: boolean;
}

function fakeDb(row: Row): MilestoneDetectionPrismaClient {
  const db: MilestoneDetectionPrismaClient = {
    user: {
      findUnique: async ({ where }) => row.users.find((u) => u.id === where.id) ?? null,
      findMany: async ({ where }) => row.users.filter((u) => where.id.in.includes(u.id)),
    },
    orgTreeEdge: {
      findMany: async ({ where }) => row.edges.filter((e) => where.sponsor_id.in.includes(e.sponsor_id)),
      update: async () => ({}),
    },
    momentumEvent: { findMany: async () => [] },
    milestone: {
      upsert: async ({ create }) => {
        row.milestoneKeys.add(create.milestone_key);
        return {};
      },
    },
    harvestMethodState: {
      findUnique: async () => (row.harvestMethodCompletedAt ? { background_matching_completed_at: row.harvestMethodCompletedAt } : null),
    },
    draftMessage: {
      findFirst: async () => (row.firstSendAt ? { approved_at: row.firstSendAt } : null),
    },
    onboardingSession: {
      findFirst: async () => (row.hasIntensitySession ? { id: 'session-1' } : null),
    },
  };
  return db;
}

function baseRow(): Row {
  return {
    users: [{ id: 'r1', name: 'Alex Rivera', rank: null, org_type: OrgType.PRIMERICA }],
    edges: [{ id: 'e1', sponsor_id: 'root', recruit_id: 'r1' }],
    milestoneKeys: new Set(),
    harvestMethodCompletedAt: null,
    firstSendAt: null,
    hasIntensitySession: false,
  };
}

describe('runMilestoneDetection (§13.4)', () => {
  it('fires recruit_gained_own_recruit the moment a recruit has their own recruit', async () => {
    const row = baseRow();
    row.edges.push({ id: 'e2', sponsor_id: 'r1', recruit_id: 'r1c' });
    row.users.push({ id: 'r1c', name: 'Sam Chen', rank: null, org_type: OrgType.PRIMERICA });
    const db = fakeDb(row);
    const licensingService = new LicensingService(new InMemoryLicensingRepository(), []);

    const result = await runMilestoneDetection('root', licensingService, db);
    expect(row.milestoneKeys.has('wp08_recruit_has_recruit_r1')).toBe(true);
    expect(result.detected.some((d) => d.kind === 'recruit_gained_own_recruit')).toBe(true);
  });

  it('is idempotent — a second detection pass over the same state does not error or duplicate distinctly', async () => {
    const row = baseRow();
    row.edges.push({ id: 'e2', sponsor_id: 'r1', recruit_id: 'r1c' });
    row.users.push({ id: 'r1c', name: 'Sam Chen', rank: null, org_type: OrgType.PRIMERICA });
    const db = fakeDb(row);
    const licensingService = new LicensingService(new InMemoryLicensingRepository(), []);

    await runMilestoneDetection('root', licensingService, db);
    const sizeAfterFirst = row.milestoneKeys.size;
    await runMilestoneDetection('root', licensingService, db);
    expect(row.milestoneKeys.size).toBe(sizeAfterFirst); // upsert — no duplicate keys, no throw.
  });

  it('auto-detects the Harvest Method completion phase item from HarvestMethodState (real signal)', async () => {
    const row = baseRow();
    row.harvestMethodCompletedAt = new Date('2026-07-01T00:00:00.000Z');
    const db = fakeDb(row);
    const licensingService = new LicensingService(new InMemoryLicensingRepository(), []);
    await runMilestoneDetection('root', licensingService, db);
    expect(row.milestoneKeys.has('wp08_timeline_launch_harvest_method_completed')).toBe(true);
  });

  it('does NOT record the Harvest Method milestone when it has not actually completed', async () => {
    const row = baseRow();
    const db = fakeDb(row);
    const licensingService = new LicensingService(new InMemoryLicensingRepository(), []);
    await runMilestoneDetection('root', licensingService, db);
    expect(row.milestoneKeys.has('wp08_timeline_launch_harvest_method_completed')).toBe(false);
  });

  it('auto-detects "licensed" from the REAL WP11 LicensingService state', async () => {
    const row = baseRow();
    const db = fakeDb(row);
    const repository = new InMemoryLicensingRepository();
    const licensingService = new LicensingService(repository, []);
    await licensingService.applyTransition('root', 'CA', 'START_PRE_LICENSING', { actor_id: 'root', actor_role: 'REP' });
    await licensingService.applyTransition('root', 'CA', 'OBTAIN_LICENSE', { actor_id: 'root', actor_role: 'REP' });

    await runMilestoneDetection('root', licensingService, db);
    expect(row.milestoneKeys.has('wp08_timeline_licensing_licensed')).toBe(true);
  });
});
