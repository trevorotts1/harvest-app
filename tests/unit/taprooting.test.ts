import { taprootingService } from '../../src/services/taprooting/taprooting.service';
import { timelineService } from '../../src/services/taprooting/timeline.service';
import { objectionService } from '../../src/services/taprooting/objection.service';
import { ObjectionCategory } from '../../src/types/taprooting';

describe('Taprooting WP08', () => {
  describe('Taprooting Service', () => {
    test('3-level org tree builds correctly for Primerica', () => {
      const tree = taprootingService.getOrgTree('rep-1', 3);
      expect(tree.repInfo.name).toBe('Maria Santos');
      expect(tree.downlines.length).toBe(2);
      expect(tree.downlines[0].downlines.length).toBe(2);
      expect(tree.downlines[1].downlines.length).toBe(1);
    });

    test('Downline metrics aggregate correctly', () => {
      const metrics = taprootingService.getDownlineMetrics('rep-1');
      expect(metrics.totalCount).toBe(6);
      expect(metrics.activeCount).toBe(4);
      expect(metrics.newRecruits).toBe(2);
    });

    test('Gate blocks non-Primerica', () => {
      const tree = taprootingService.getOrgTree('rep-ext-1');
      expect(tree.downlines.length).toBe(0);
      expect(tree.metrics.totalCount).toBe(0);
    });
  });

  describe('Timeline Service', () => {
    test('Timeline returns events ordered', () => {
      const events = timelineService.getActivityTimeline('rep-1');
      expect(events.length).toBeGreaterThan(0);
      for (let i = 0; i < events.length - 1; i++) {
        expect(new Date(events[i].timestamp).getTime())
          .toBeLessThanOrEqual(new Date(events[i + 1].timestamp).getTime());
      }
    });
  });

  describe('Objection Handler', () => {
    test('Objection handler returns doctrine-compliant responses', () => {
      const objections = objectionService.getObjections(ObjectionCategory.COST);
      expect(objections.length).toBeGreaterThan(0);
      expect(objections[0].doctrineAligned).toBe(true);
    });

    test('Returns null for unknown objection ID', () => {
      const response = objectionService.getResponse('non-existent');
      expect(response).toBeNull();
    });
  });
});
