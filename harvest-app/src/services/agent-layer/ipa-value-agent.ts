// WP04 IPA Value Agent — calculates IPA scores and dollar-value equivalents

import {
  AgentType,
  AgentExecutionMode,
  AgentActionType,
  AgentAction,
  IPAState,
  IPA_BASELINE_RATIO,
} from '../../types/agent-layer';
import { BaseAgent } from './base-agent';

/** Dollar value per IPA at baseline */
const IPA_DOLLAR_VALUE_BASELINE = 50;

/**
 * IPA Value Agent: Calculates IPA scores and dollar-value equivalents.
 * Runs parallel, real-time. Self-optimizing after 20+ data points.
 *
 * Baseline ratio: 20 introductions : 5 responses : 1 appointment (20:5:1)
 */
export class IPAValueAgent extends BaseAgent {
  readonly agentType = AgentType.IPA_VALUE;
  readonly executionMode = AgentExecutionMode.PARALLEL;
  readonly description = 'Calculates IPA scores and dollar-value equivalents';

  /**
   * Calculate IPA state from activity data.
   * Self-optimizes after 20+ data points using rolling 30-day average.
   */
  calculateIPA(input: {
    userId: string;
    totalIntroductions: number;
    totalResponses: number;
    totalAppointments: number;
    totalAppointmentsRun: number;
    totalClosed: number;
    historicalIntroductions: number[];
    historicalResponses: number[];
    historicalAppointments: number[];
  }): IPAState {
    const { userId, totalIntroductions, totalResponses, totalAppointments,
            totalAppointmentsRun, totalClosed } = input;

    // Agent ratio: introductions / responses
    const agentRatio = totalResponses > 0
      ? totalIntroductions / totalResponses
      : IPA_BASELINE_RATIO.INTRODUCTIONS / IPA_BASELINE_RATIO.RESPONSES;

    // Field trainer ratio: appointments run / closed
    const fieldTrainerRatio = totalClosed > 0
      ? totalAppointmentsRun / totalClosed
      : 0;

    // Data points available for self-optimization
    const dataPoints = input.historicalIntroductions.length;

    // Dollar value calculation
    const dollarValue = this.calculateDollarValue(
      totalAppointments,
      totalClosed
    );

    // Self-optimizing target based on rolling average
    const optimizedTarget = dataPoints >= 20
      ? this.computeOptimizedTarget(input.historicalAppointments)
      : IPA_BASELINE_RATIO.APPOINTMENTS;

    return {
      userId,
      agentRatio: Math.round(agentRatio * 100) / 100,
      fieldTrainerRatio: Math.round(fieldTrainerRatio * 100) / 100,
      dollarValue,
      dataPoints,
      optimizedTarget,
    };
  }

  /**
   * Calculate dollar value of IPA activities.
   */
  private calculateDollarValue(appointments: number, closed: number): number {
    return (appointments * IPA_DOLLAR_VALUE_BASELINE) + (closed * IPA_DOLLAR_VALUE_BASELINE * 4);
  }

  /**
   * Compute self-optimizing target from rolling 30-day average.
   * After 20+ data points, adjusts targets based on actual performance.
   */
  private computeOptimizedTarget(historicalAppointments: number[]): number {
    if (historicalAppointments.length < 20) {
      return IPA_BASELINE_RATIO.APPOINTMENTS;
    }

    const recent = historicalAppointments.slice(-30);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    return Math.max(1, Math.round(avg));
  }
}