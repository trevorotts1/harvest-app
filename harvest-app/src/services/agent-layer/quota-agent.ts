// WP04 Quota Agent — tracks production goals vs actuals

import {
  AgentType,
  AgentExecutionMode,
  AgentActionType,
  AgentAction,
  QuotaState,
  PaceStatus,
  computePaceStatus,
} from '../../types/agent-layer';
import { BaseAgent } from './base-agent';

/**
 * Quota Agent: Tracks personal production goals vs actuals.
 * Runs parallel, real-time.
 *
 * Flags underperformance within 1 hour of missed milestone.
 */
export class QuotaAgent extends BaseAgent {
  readonly agentType = AgentType.QUOTA;
  readonly executionMode = AgentExecutionMode.PARALLEL;
  readonly description = 'Tracks personal production goals vs actuals';

  /**
   * Evaluate quota state and flag underperformance.
   */
  evaluateQuota(
    weeklyTarget: number,
    weeklyActual: number,
    monthlyTarget: number,
    monthlyActual: number,
    userId: string,
    lastMilestoneCheck: Date
  ): QuotaState {
    const weeklyPace = computePaceStatus(weeklyActual, weeklyTarget);
    const underperformanceFlagged =
      weeklyPace === PaceStatus.BEHIND || weeklyPace === PaceStatus.CRITICAL;

    return {
      userId,
      weeklyTarget,
      weeklyActual,
      monthlyTarget,
      monthlyActual,
      underperformanceFlagged,
      lastMilestoneCheck,
    };
  }

  /**
   * Check if a milestone has been missed (within 1-hour detection window).
   */
  checkMilestone(quotaState: QuotaState): AgentAction | null {
    const now = new Date();
    const hoursSinceCheck = (now.getTime() - new Date(quotaState.lastMilestoneCheck).getTime()) / (1000 * 60 * 60);

    if (hoursSinceCheck < 1 && !quotaState.underperformanceFlagged) {
      return null;
    }

    if (quotaState.underperformanceFlagged) {
      return this.createAction(
        quotaState.userId,
        AgentActionType.FLAG_UNDERPERFORMANCE,
        {
          weeklyTarget: quotaState.weeklyTarget,
          weeklyActual: quotaState.weeklyActual,
          paceStatus: computePaceStatus(quotaState.weeklyActual, quotaState.weeklyTarget),
        }
      );
    }

    return null;
  }
}