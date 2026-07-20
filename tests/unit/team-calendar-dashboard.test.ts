// T-45 (WP09 §14.4; uiux §5.9) — DashboardService: the anti-surveillance invariant (QC checkpoints
// 7/8, critical-failure conditions), org-scoping (§16.6 row 2, upline=team / rvp=org-wide), and the
// team-availability aggregate that structurally cannot expose an individual CalDAV/Google block.

import { DashboardService, resolveTeamMemberIds, paceStatusFor, type RosterPrismaClient } from '../../src/services/team-calendar/dashboard.service';

function makeMockPrisma(fixtures: {
  users?: { id: string; name: string; upline_id?: string | null; organization_id?: string | null }[];
  momentumEvents?: { user_id: string; law: string; points: number; created_at: Date }[];
  appointments?: { trainer_id: string | null; rep_id: string; status: string; confirmed_start: Date | null }[];
  coachingSessions?: { rep_id: string; trainer_id: string; status: string; starts_at: Date }[];
  handoffs?: { id: string; user_id: string; contact_id: string; trigger_reason: string; state: string; invited_at: Date }[];
  busyBlocks?: { user_id: string; starts_at: Date; ends_at: Date }[];
}): RosterPrismaClient {
  return {
    user: {
      async findMany({ where }) {
        const w = where as { organization_id?: string; upline_id?: string; id?: { in?: string[]; not?: string } };
        return (fixtures.users ?? []).filter((u) => {
          if (w.organization_id !== undefined && u.organization_id !== w.organization_id) return false;
          if (w.upline_id !== undefined && u.upline_id !== w.upline_id) return false;
          if (w.id?.in && !w.id.in.includes(u.id)) return false;
          if (w.id?.not && u.id === w.id.not) return false;
          return true;
        });
      },
    },
    momentumEvent: {
      async findMany() {
        return fixtures.momentumEvents ?? [];
      },
    },
    appointment: {
      async findMany({ where }) {
        const w = where as { trainer_id?: string; confirmed_start?: { lte?: Date }; status?: { in?: string[] } };
        return (fixtures.appointments ?? []).filter((a) => {
          if (w.trainer_id && a.trainer_id !== w.trainer_id) return false;
          if (w.status?.in && !w.status.in.includes(a.status)) return false;
          if (w.confirmed_start?.lte && (!a.confirmed_start || a.confirmed_start > w.confirmed_start.lte)) return false;
          return true;
        });
      },
    },
    coachingSession: {
      async findMany() {
        return fixtures.coachingSessions ?? [];
      },
    },
    threeWayHandoff: {
      async findMany({ where }) {
        const w = where as { upline_id?: string; organization_id?: string };
        return (fixtures.handoffs ?? []).filter((h) => !w.upline_id || h.user_id === w.upline_id || true);
      },
    },
    calendarBusyBlock: {
      async findMany() {
        return fixtures.busyBlocks ?? [];
      },
    },
  };
}

describe('WP09 DashboardService — anti-surveillance + org-scoping', () => {
  describe('paceStatusFor — §14.4 "on track / needs a push / behind"', () => {
    it('maps recency to the doctrine-safe pace vocabulary, never a numeric score', () => {
      expect(paceStatusFor(0)).toBe('on_track');
      expect(paceStatusFor(4)).toBe('needs_a_push');
      expect(paceStatusFor(10)).toBe('behind');
      expect(paceStatusFor(null)).toBe('needs_a_push'); // no data yet is a learning state, not "behind"
    });
  });

  describe('resolveTeamMemberIds — §16.6 row 2 scoping', () => {
    it('an UPLINE caller gets exactly their direct downline', async () => {
      const prisma = makeMockPrisma({
        users: [
          { id: 'rep-1', name: 'Rep One', upline_id: 'upline-1', organization_id: 'org-1' },
          { id: 'rep-2', name: 'Rep Two', upline_id: 'upline-1', organization_id: 'org-1' },
          { id: 'rep-3', name: 'Rep Three', upline_id: 'someone-else', organization_id: 'org-1' },
        ],
      });
      const ids = await resolveTeamMemberIds(prisma, { id: 'upline-1', role: 'UPLINE', organizationId: 'org-1' });
      expect(ids.sort()).toEqual(['rep-1', 'rep-2']);
    });

    it('an RVP caller gets the whole organization, never a different org', async () => {
      const prisma = makeMockPrisma({
        users: [
          { id: 'rep-1', name: 'Rep One', organization_id: 'org-1' },
          { id: 'rep-2', name: 'Rep Two', organization_id: 'org-1' },
          { id: 'rep-99', name: 'Other Org Rep', organization_id: 'org-2' },
        ],
      });
      const ids = await resolveTeamMemberIds(prisma, { id: 'rvp-1', role: 'RVP', organizationId: 'org-1' });
      expect(ids.sort()).toEqual(['rep-1', 'rep-2']);
      expect(ids).not.toContain('rep-99');
    });

    it('returns empty for an RVP with no organization on file — never a blank cross-org fallback', async () => {
      const prisma = makeMockPrisma({ users: [] });
      const ids = await resolveTeamMemberIds(prisma, { id: 'rvp-1', role: 'RVP', organizationId: null });
      expect(ids).toEqual([]);
    });
  });

  describe('anti-surveillance invariant (QC checkpoints 7/8, critical-failure)', () => {
    it('the roster row shape carries ONLY pace + momentum + outcomes — no screen-time/keystroke/per-task field exists', async () => {
      const prisma = makeMockPrisma({
        users: [{ id: 'rep-1', name: 'Rep One' }],
        momentumEvents: [{ user_id: 'rep-1', law: 'grow', points: 5, created_at: new Date() }],
      });
      const service = new DashboardService(prisma);
      const roster = await service.getRoster(['rep-1']);
      expect(roster.length).toBe(1);
      const keys = Object.keys(roster[0]);
      for (const forbidden of ['screenTime', 'keystrokes', 'sessionDuration', 'clickCount', 'activityFeed', 'rank', 'score']) {
        expect(keys).not.toContain(forbidden);
      }
      expect(keys.sort()).toEqual(
        ['inactivityFlagDays', 'lastActiveAt', 'momentumBand', 'momentumScore', 'name', 'paceIcon', 'paceLabel', 'paceStatus', 'userId'].sort()
      );
    });

    it('sortRoster("pace") groups by track status, never a numeric "worst performer" framing', async () => {
      const prisma = makeMockPrisma({
        users: [
          { id: 'rep-behind', name: 'Behind Rep' },
          { id: 'rep-on-track', name: 'On Track Rep' },
        ],
        momentumEvents: [
          { user_id: 'rep-on-track', law: 'grow', points: 5, created_at: new Date() },
        ],
      });
      const service = new DashboardService(prisma);
      const roster = await service.getRoster(['rep-behind', 'rep-on-track']);
      const sorted = service.sortRoster(roster, 'pace');
      // Grouped by PACE STATUS (on_track before needs_a_push/behind) — never a bare numeric rank field.
      expect(sorted.every((r) => !('rank' in r))).toBe(true);
      expect(PACE_STATUS_ORDER(sorted[0].paceStatus)).toBeLessThanOrEqual(PACE_STATUS_ORDER(sorted[sorted.length - 1].paceStatus));
    });

    it('the default roster order is alphabetical by name — not implicitly "best to worst"', async () => {
      const prisma = makeMockPrisma({ users: [{ id: 'z', name: 'Zed' }, { id: 'a', name: 'Amy' }] });
      const service = new DashboardService(prisma);
      const roster = await service.getRoster(['z', 'a']);
      expect(roster.map((r) => r.name)).toEqual(['Amy', 'Zed']);
    });

    it('the team-availability aggregate returns only coarse busy COUNTS per time bucket — never an individual block, never which provider (Google vs. CalDAV) contributed it (§14.1/§14.6-2)', async () => {
      const now = new Date('2025-06-09T13:00:00Z');
      const prisma = makeMockPrisma({
        busyBlocks: [
          { user_id: 'rep-1', starts_at: now, ends_at: new Date(now.getTime() + 3600_000) }, // could be Google OR CalDAV — indistinguishable by design
        ],
      });
      const service = new DashboardService(prisma);
      const aggregate = await service.getTeamAvailabilityAggregate(['rep-1', 'rep-2'], now, 4, 2);
      expect(aggregate.length).toBeGreaterThan(0);
      for (const bucket of aggregate) {
        const keys = Object.keys(bucket);
        expect(keys.sort()).toEqual(['bucketStart', 'busyCount', 'teamSize']);
        expect(typeof bucket.busyCount).toBe('number');
      }
      expect(aggregate[0].busyCount).toBe(1);
      expect(aggregate[0].teamSize).toBe(2);
    });

    it('Field Trainer\'s Ratio is owned honestly — no-shows count against it (§14.3)', async () => {
      const now = new Date('2025-06-09T13:00:00Z');
      const past = new Date(now.getTime() - 3600_000);
      const prisma = makeMockPrisma({
        appointments: [
          { trainer_id: 'trainer-1', rep_id: 'rep-1', status: 'HELD', confirmed_start: past },
          { trainer_id: 'trainer-1', rep_id: 'rep-2', status: 'NO_SHOW', confirmed_start: past },
        ],
      });
      const service = new DashboardService(prisma);
      const panel = await service.getFieldTrainerRatioPanel('trainer-1', now);
      expect(panel.appointmentsRun).toBe(2);
      expect(panel.noShows).toBe(1);
      expect(panel.closeRate).toBeCloseTo(0.5);
    });
  });
});

function PACE_STATUS_ORDER(status: string): number {
  return { on_track: 0, needs_a_push: 1, behind: 2 }[status as 'on_track' | 'needs_a_push' | 'behind'];
}
