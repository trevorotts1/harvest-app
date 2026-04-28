// WP04 Reporting Agent — compiles daily briefings and pipeline snapshots

import {
  AgentType,
  AgentExecutionMode,
  DailyBriefing,
  OvernightActivitySummary,
  PipelineSnapshot,
  MomentumIndicators,
  PipelineStageChange,
  ContactResponse,
  AppointmentSummary,
  PrioritizedAction,
  ComplianceFlagItem,
  ThreeLawCompositeScore,
  InactivityState,
  PaceStatus,
  computePaceStatus,
} from '../../types/agent-layer';
import { PipelineStage } from '../../types/warm-market';
import { BaseAgent } from './base-agent';

/**
 * Reporting Agent: Compiles activity metrics and pipeline snapshots.
 * Runs parallel, scheduled (daily at 06:00 local time).
 *
 * Outputs: daily briefing, pipeline snapshot, momentum indicators
 */
export class ReportingAgent extends BaseAgent {
  readonly agentType = AgentType.REPORTING;
  readonly executionMode = AgentExecutionMode.PARALLEL;
  readonly description = 'Compiles activity metrics and pipeline snapshots';

  /**
   * Compile a full daily briefing for a rep.
   * Grounded in actual contact/pipeline data from WP02.
   */
  compileDailyBriefing(input: {
    userId: string;
    date: string;
    overnightActivity: OvernightActivitySummary;
    newResponses: ContactResponse[];
    todayAppointments: AppointmentSummary[];
    actionQueue: PrioritizedAction[];
    pipelineCounts: Record<PipelineStage, number>;
    totalContacts: number;
    weeklyIPAs: number;
    weeklyIPATarget: number;
    anchorStatement: string | null;
    threeLawsStatus: ThreeLawCompositeScore;
    inactivityAlerts: InactivityState[];
    complianceFlags: ComplianceFlagItem[];
    daysSinceLastIPA: number;
  }): DailyBriefing {
    return {
      userId: input.userId,
      date: input.date,
      overnightActivity: input.overnightActivity,
      newResponses: input.newResponses,
      todayAppointments: input.todayAppointments,
      actionQueue: input.actionQueue,
      pipelineSnapshot: this.generatePipelineSnapshot(
        input.pipelineCounts,
        input.totalContacts
      ),
      momentumIndicators: this.calculateMomentum(
        input.weeklyIPAs,
        input.weeklyIPATarget,
        input.daysSinceLastIPA
      ),
      anchorStatement: input.anchorStatement,
      threeLawsStatus: input.threeLawsStatus,
      inactivityAlerts: input.inactivityAlerts,
      complianceFlags: input.complianceFlags,
    };
  }

  /**
   * Generate pipeline snapshot from stage counts.
   */
  generatePipelineSnapshot(
    stageCounts: Record<PipelineStage, number>,
    totalContacts: number
  ): PipelineSnapshot {
    const introduced = (stageCounts[PipelineStage.NEW] ?? 0) + (stageCounts[PipelineStage.ENGAGED] ?? 0);
    const responded = stageCounts[PipelineStage.ENGAGED] ?? 0;
    const appointment = stageCounts[PipelineStage.PIPELINE] ?? 0;
    const activated = stageCounts[PipelineStage.ACTIVATED] ?? 0;

    return {
      totalContacts,
      byStage: stageCounts,
      introducedCount: introduced,
      respondedCount: responded,
      appointmentCount: appointment,
      activatedCount: activated,
      agentRatio: responded > 0 ? introduced / responded : 0,
      closingRatio: appointment > 0 ? activated / appointment : 0,
    };
  }

  /**
   * Calculate momentum indicators for the rep.
   */
  calculateMomentum(
    weeklyIPAs: number,
    weeklyIPATarget: number,
    daysSinceLastIPA: number
  ): MomentumIndicators {
    const paceStatus = computePaceStatus(weeklyIPAs, weeklyIPATarget);
    let trendDirection: 'UP' | 'FLAT' | 'DOWN' = 'FLAT';
    if (paceStatus === PaceStatus.AHEAD) trendDirection = 'UP';
    else if (paceStatus === PaceStatus.BEHIND || paceStatus === PaceStatus.CRITICAL) trendDirection = 'DOWN';

    const weeklyScore = Math.min(100, Math.round((weeklyIPAs / Math.max(1, weeklyIPATarget)) * 100));

    return {
      weeklyScore,
      trendDirection,
      daysSinceLastIPA,
      ipaValueThisWeek: weeklyIPAs,
      ipaTargetThisWeek: weeklyIPATarget,
      paceStatus,
    };
  }
}