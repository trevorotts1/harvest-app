import { getAgentInventory, runThreeLawsMonitor } from '../../src/services/agent-layer/agent.service';
import { AgentType, AgentStatus, ThreeLawsViolation } from '../../src/types/agent-layer';
import { calculateProgressScore } from '../../src/services/agent-layer/mission-control.service';

describe('Agent Layer', () => {
  test('Agent inventory returns correct types', async () => {
    const inv = await getAgentInventory('user-1');
    expect(Array.isArray(inv)).toBe(true);
  });

  test('Three Laws monitor detects neglect', () => {
    const oldDate = new Date(Date.now() - 50 * 60 * 60 * 1000);
    const violations = runThreeLawsMonitor('u1', [{ agentType: AgentType.PROSPECTING, status: AgentStatus.ACTIVE, lastRunAt: oldDate, currentQueue: [] }]);
    expect(violations).toContain(ThreeLawsViolation.NEGLECT);
  });

  test('Progress score calculation', () => {
    const score = calculateProgressScore('u1');
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
