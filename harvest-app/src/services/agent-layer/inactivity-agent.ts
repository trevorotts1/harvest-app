// WP04 Inactivity & Re-engagement Agent — Three Laws corrective nudges

import {
  AgentType,
  AgentExecutionMode,
  AgentActionType,
  AgentAction,
  InactivityState,
  InactivityLevel,
  ReengagementStep,
  CorrectiveNudge,
  ThreeLaw,
  ThreeLawScore,
  ThreeLawCompositeScore,
  ScoringLevel,
  computeInactivityLevel,
  computeScoringLevel,
  INACTIVITY_THRESHOLDS,
} from '../../types/agent-layer';
import { BaseAgent } from './base-agent';

/**
 * Inactivity & Re-engagement Agent: Detects stalled contacts/rep,
 * executes win-back sequences, issues Three Laws corrective nudges.
 * Runs 24/7, parallel.
 *
 * Three Laws Monitoring:
 * - Grow Downline: are they adding contacts and reaching out?
 * - Engage Base: are they following up with existing contacts?
 * - Increase Wealth: are appointments being held and closed?
 *
 * Corrective nudge sequence:
 * - 3 days inactive: anchor statement reminder
 * - 5 days inactive: gentle activity suggestion
 * - 7 days inactive: upline notification
 * - 14+ days: escalation to compliance/admin
 */
export class InactivityReengagementAgent extends BaseAgent {
  readonly agentType = AgentType.INACTIVITY_REENGAGEMENT;
  readonly executionMode = AgentExecutionMode.PARALLEL;
  readonly description = 'Detects stalled contacts, executes win-back sequences and Three Laws nudges';

  /**
   * Detect inactivity level for a user.
   */
  detectInactivity(
    userId: string,
    lastActivityDate: Date | null,
    existingState?: Partial<InactivityState>
  ): InactivityState {
    const daysInactive = lastActivityDate
      ? Math.floor((Date.now() - new Date(lastActivityDate).getTime()) / (1000 * 60 * 60 * 24))
      : 999; // never active

    const level = computeInactivityLevel(daysInactive);

    return {
      userId,
      level,
      daysInactive,
      lastActivityDate,
      reengagementSequenceStep: this.determineReengagementStep(level),
      correctiveNudgesIssued: existingState?.correctiveNudgesIssued ?? 0,
      uplineNotified: existingState?.uplineNotified ?? false,
    };
  }

  /**
   * Determine which re-engagement step to execute.
   */
  private determineReengagementStep(level: InactivityLevel): ReengagementStep {
    switch (level) {
      case InactivityLevel.NONE: return ReengagementStep.NOT_STARTED;
      case InactivityLevel.LOW: return ReengagementStep.ANCHOR_REMINDER;
      case InactivityLevel.MEDIUM: return ReengagementStep.GENTLE_NUDGE;
      case InactivityLevel.HIGH: return ReengagementStep.UPLINE_ALERT;
      case InactivityLevel.CRITICAL: return ReengagementStep.ESCALATION;
    }
  }

  /**
   * Issue a corrective nudge based on Three Law neglect.
   */
  issueThreeLawNudge(
    law: ThreeLaw,
    severity: 'GENTLE' | 'FIRM' | 'URGENT',
    userId: string
  ): CorrectiveNudge {
    const messages: Record<ThreeLaw, Record<string, string>> = {
      [ThreeLaw.GROW_DOWNLINE]: {
        GENTLE: 'Your network grows when you reach out. Consider adding a new contact today.',
        FIRM: "You haven't added new contacts in a while. Growing your downline is the first law — it's time to act.",
        URGENT: 'Your downline growth has stalled significantly. This needs immediate attention to get back on track.',
      },
      [ThreeLaw.ENGAGE_BASE]: {
        GENTLE: 'Your contacts are waiting to hear from you. A quick check-in goes a long way.',
        FIRM: "Engagement is dropping. Your existing contacts need attention — they won't wait forever.",
        URGENT: 'Your engagement rate has critically declined. This is the foundation of your business — take action now.',
      },
      [ThreeLaw.INCREASE_WEALTH]: {
        GENTLE: 'Your pipeline has potential. Consider scheduling an appointment this week.',
        FIRM: "Wealth comes from held appointments. You're behind on closing — let's get back on track.",
        URGENT: 'Wealth generation has stalled. Without appointments, the pipeline dries up. This is urgent.',
      },
    };

    const suggestedActions: Record<ThreeLaw, string> = {
      [ThreeLaw.GROW_DOWNLINE]: 'Add 3 new contacts from your warm market today',
      [ThreeLaw.ENGAGE_BASE]: 'Send a check-in message to 5 existing contacts',
      [ThreeLaw.INCREASE_WEALTH]: 'Schedule at least 1 appointment this week',
    };

    return {
      id: crypto.randomUUID(),
      law,
      severity,
      message: messages[law][severity],
      suggestedAction: suggestedActions[law],
      triggeredAt: new Date(),
      escalatedToUpline: severity === 'URGENT',
    };
  }

  /**
   * Evaluate Three Laws compliance for a user.
   * Detects which laws are being neglected and issues corrective nudges.
   */
  evaluateThreeLaws(input: {
    userId: string;
    contactsAddedThisWeek: number;
    contactsEngagedThisWeek: number;
    appointmentsThisWeek: number;
    contactsAddedLastWeek: number;
    contactsEngagedLastWeek: number;
    appointmentsLastWeek: number;
    lastContactAddDate: string | null;
    lastEngagementDate: string | null;
    lastAppointmentDate: string | null;
  }): ThreeLawCompositeScore {
    const scores: Record<ThreeLaw, ThreeLawScore> = {
      [ThreeLaw.GROW_DOWNLINE]: this.scoreGrowLaw(input),
      [ThreeLaw.ENGAGE_BASE]: this.scoreEngageLaw(input),
      [ThreeLaw.INCREASE_WEALTH]: this.scoreWealthLaw(input),
    };

    // Weighted composite: equal weighting
    const compositeScore = Math.round(
      (scores[ThreeLaw.GROW_DOWNLINE].score +
       scores[ThreeLaw.ENGAGE_BASE].score +
       scores[ThreeLaw.INCREASE_WEALTH].score) / 3
    );

    const level = computeScoringLevel(compositeScore);

    // Identify neglected laws (score below 30)
    const neglectedLaws = Object.entries(scores)
      .filter(([_, s]) => s.score < 30)
      .map(([law]) => law as ThreeLaw);

    return {
      scores,
      compositeScore,
      level,
      neglectedLaws,
      requiresIntervention: neglectedLaws.length > 0,
    };
  }

  private scoreGrowLaw(input: {
    contactsAddedThisWeek: number;
    contactsAddedLastWeek: number;
    lastContactAddDate: string | null;
  }): ThreeLawScore {
    let score = 0;
    if (input.contactsAddedThisWeek >= 7) score = 100;
    else if (input.contactsAddedThisWeek >= 5) score = 70;
    else if (input.contactsAddedThisWeek >= 3) score = 50;
    else if (input.contactsAddedThisWeek >= 1) score = 30;
    else score = 0;

    const trend = input.contactsAddedThisWeek >= input.contactsAddedLastWeek ? 'IMPROVING' :
                  input.contactsAddedThisWeek === input.contactsAddedLastWeek ? 'STABLE' : 'DECLINING';

    return {
      law: ThreeLaw.GROW_DOWNLINE,
      score,
      trend,
      lastActivityDate: input.lastContactAddDate,
      correctiveNudge: score < 30 ? this.issueThreeLawNudge(ThreeLaw.GROW_DOWNLINE, 'GENTLE', '') : undefined,
    };
  }

  private scoreEngageLaw(input: {
    contactsEngagedThisWeek: number;
    contactsEngagedLastWeek: number;
    lastEngagementDate: string | null;
  }): ThreeLawScore {
    let score = 0;
    if (input.contactsEngagedThisWeek >= 10) score = 100;
    else if (input.contactsEngagedThisWeek >= 7) score = 70;
    else if (input.contactsEngagedThisWeek >= 4) score = 50;
    else if (input.contactsEngagedThisWeek >= 1) score = 30;
    else score = 0;

    const trend = input.contactsEngagedThisWeek >= input.contactsEngagedLastWeek ? 'IMPROVING' :
                  input.contactsEngagedThisWeek === input.contactsEngagedLastWeek ? 'STABLE' : 'DECLINING';

    return {
      law: ThreeLaw.ENGAGE_BASE,
      score,
      trend,
      lastActivityDate: input.lastEngagementDate,
      correctiveNudge: score < 30 ? this.issueThreeLawNudge(ThreeLaw.ENGAGE_BASE, 'GENTLE', '') : undefined,
    };
  }

  private scoreWealthLaw(input: {
    appointmentsThisWeek: number;
    appointmentsLastWeek: number;
    lastAppointmentDate: string | null;
  }): ThreeLawScore {
    let score = 0;
    if (input.appointmentsThisWeek >= 3) score = 100;
    else if (input.appointmentsThisWeek >= 2) score = 70;
    else if (input.appointmentsThisWeek >= 1) score = 50;
    else score = 0;

    const trend = input.appointmentsThisWeek >= input.appointmentsLastWeek ? 'IMPROVING' :
                  input.appointmentsThisWeek === input.appointmentsLastWeek ? 'STABLE' : 'DECLINING';

    return {
      law: ThreeLaw.INCREASE_WEALTH,
      score,
      trend,
      lastActivityDate: input.lastAppointmentDate,
      correctiveNudge: score < 30 ? this.issueThreeLawNudge(ThreeLaw.INCREASE_WEALTH, 'FIRM', '') : undefined,
    };
  }

  /**
   * Generate re-engagement action based on inactivity level.
   */
  generateReengagementAction(state: InactivityState): AgentAction | null {
    if (state.level === InactivityLevel.NONE) return null;

    return this.createAction(
      state.userId,
      AgentActionType.TRIGGER_REENGAGEMENT,
      {
        inactivityLevel: state.level,
        daysInactive: state.daysInactive,
        reengagementStep: state.reengagementSequenceStep,
        uplineNotified: state.uplineNotified,
      }
    );
  }

  /**
   * Determine if upline escalation is needed.
   */
  shouldEscalateToUpline(state: InactivityState): boolean {
    return state.level === InactivityLevel.HIGH || state.level === InactivityLevel.CRITICAL;
  }
}