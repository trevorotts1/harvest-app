import { PrismaClient } from '@prisma/client';
import {
  AgentAction,
  AgentActionStatus,
  AgentActionType,
  AgentType,
  AgentViewRole,
  AGENT_ROLE_VISIBILITY,
  ComplianceFlagItem,
  DailyBriefing,
  InactivityLevel,
  InactivityState,
  PaceStatus,
  PipelineEvent,
  PipelineEventType,
  PrioritizedAction,
  RepSummary,
  ScoringLevel,
  TeamOverview,
  ThreeLaw,
  UplineDashboard,
  WP05AgentIntentContract,
  WP09AppointmentContract,
  enforceRoleVisibility,
} from '../../types/agent-layer';
import { PipelineStage, RelationshipType, WP04AgentFeed } from '../../types/warm-market';
import { ProspectingAgent } from './prospecting-agent';
import { PreSaleNurtureAgent } from './pre-sale-nurture-agent';
import { PostSaleNurtureAgent } from './post-sale-nurture-agent';
import { AppointmentSettingAgent } from './appointment-agent';
import { ReportingAgent } from './reporting-agent';
import { QuotaAgent } from './quota-agent';
import { IPAValueAgent } from './ipa-value-agent';
import { InactivityReengagementAgent } from './inactivity-agent';
import { AgentStateRepository, PrismaAgentStateRepository } from './repository';

const prisma = new PrismaClient();

const DEFAULT_PIPELINE_COUNTS: Record<PipelineStage, number> = {
  [PipelineStage.NEW]: 0,
  [PipelineStage.ENGAGED]: 0,
  [PipelineStage.PIPELINE]: 0,
  [PipelineStage.ACTIVATED]: 0,
  [PipelineStage.ARCHIVED]: 0,
};

function toPipelineStage(value: unknown): PipelineStage {
  const normalized = String(value ?? PipelineStage.NEW).toLowerCase();
  return (Object.values(PipelineStage) as string[]).includes(normalized)
    ? (normalized as PipelineStage)
    : PipelineStage.NEW;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function actionToPrioritizedAction(action: AgentAction, priority: number): PrioritizedAction {
  return {
    id: action.id,
    priority,
    actionType: action.actionType,
    description: String(action.payload.description ?? action.payload.message ?? `${action.agentType} action ready`),
    contactId: action.contactId,
    contactName: typeof action.payload.contactName === 'string' ? action.payload.contactName : undefined,
    dueBy: action.payload.dueBy ? new Date(String(action.payload.dueBy)) : undefined,
    estimatedMinutes: Number(action.payload.estimatedMinutes ?? 2),
    agentType: action.agentType,
    requiresHumanApproval: Boolean(action.payload.requiresHumanApproval ?? true),
  };
}

function createAgentAction(input: {
  userId: string;
  contactId?: string;
  agentType: AgentType;
  actionType: AgentActionType;
  payload: Record<string, unknown>;
}): AgentAction {
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    contactId: input.contactId,
    agentType: input.agentType,
    actionType: input.actionType,
    status: AgentActionStatus.PENDING,
    payload: input.payload,
    createdAt: new Date(),
  };
}

export class MissionControl {
  private prospectingAgent = new ProspectingAgent();
  private preSaleNurtureAgent = new PreSaleNurtureAgent();
  private postSaleNurtureAgent = new PostSaleNurtureAgent();
  private appointmentAgent = new AppointmentSettingAgent();
  private reportingAgent = new ReportingAgent();
  private quotaAgent = new QuotaAgent();
  private ipaValueAgent = new IPAValueAgent();
  private inactivityAgent = new InactivityReengagementAgent();

  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly repository: AgentStateRepository = new PrismaAgentStateRepository(prisma),
  ) {}

  async getRepBriefing(userId: string): Promise<DailyBriefing> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { contacts: true },
    });

    if (!user) throw new Error('User not found');

    const state = await this.db.missionControlState.upsert({
      where: { user_id: userId },
      create: { user_id: userId },
      update: {},
    });

    const pipelineCounts = { ...DEFAULT_PIPELINE_COUNTS };
    for (const contact of user.contacts) {
      const stage = toPipelineStage((contact as any).pipeline_stage);
      pipelineCounts[stage] = (pipelineCounts[stage] ?? 0) + 1;
    }

    const pendingActions = await this.repository.listPendingActions(userId, 20);
    const actionQueue = pendingActions.map(actionToPrioritizedAction);
    const overnightEvents = await this.repository.listEventsSince(userId, startOfToday());

    const newResponses = overnightEvents
      .filter((event) => event.actionType === AgentActionType.FLAG_READY_FOR_APPOINTMENT || event.payload.pipelineEventType === PipelineEventType.RESPONSE_RECEIVED)
      .map((event) => ({
        contactId: event.contactId ?? '',
        contactName: String(event.payload.contactName ?? 'Contact'),
        messagePreview: String(event.payload.messagePreview ?? 'New response received'),
        receivedAt: event.timestamp,
        suggestedAction: 'Review response and approve the next relationship-first action',
      }));

    const todayAppointments = pendingActions
      .filter((action) => action.agentType === AgentType.APPOINTMENT)
      .map((action) => ({
        id: action.id,
        contactId: action.contactId ?? '',
        contactName: String(action.payload.contactName ?? 'Contact'),
        scheduledTime: String(action.payload.scheduledTime ?? new Date().toISOString()),
        durationMinutes: Number(action.payload.durationMinutes ?? 30),
        type: 'INTRO' as const,
        status: 'PENDING_CONFIRMATION' as const,
      }));

    const complianceFlags: ComplianceFlagItem[] = pendingActions
      .filter((action) => action.status === AgentActionStatus.BLOCKED_BY_COMPLIANCE || action.payload.complianceFlag === true)
      .map((action) => ({
        id: action.id,
        contentType: action.actionType,
        riskScore: Number(action.complianceResult?.riskScore ?? 0),
        outcome: action.complianceResult?.outcome === 'BLOCK' ? 'BLOCK' : 'FLAG',
        status: 'PENDING_REVIEW',
        createdAt: action.createdAt,
      }));

    const compositeScore = Math.round(((state.three_law_grow_score ?? 0) + (state.three_law_engage_score ?? 0) + (state.three_law_wealth_score ?? 0)) / 3);
    const neglectedLaws = [
      [ThreeLaw.GROW_DOWNLINE, state.three_law_grow_score],
      [ThreeLaw.ENGAGE_BASE, state.three_law_engage_score],
      [ThreeLaw.INCREASE_WEALTH, state.three_law_wealth_score],
    ].filter(([, score]) => Number(score) < 40).map(([law]) => law as ThreeLaw);

    return this.reportingAgent.compileDailyBriefing({
      userId,
      date: new Date().toISOString().split('T')[0],
      overnightActivity: {
        prospectingActions: overnightEvents.filter((event) => event.agentType === AgentType.PROSPECTING).length,
        nurtureMessagesSent: overnightEvents.filter((event) => event.agentType === AgentType.PRE_SALE_NURTURE || event.agentType === AgentType.POST_SALE_NURTURE).length,
        appointmentsScheduled: overnightEvents.filter((event) => event.agentType === AgentType.APPOINTMENT).length,
        reengagementAttempts: overnightEvents.filter((event) => event.agentType === AgentType.INACTIVITY_REENGAGEMENT).length,
        complianceBlocks: complianceFlags.filter((flag) => flag.outcome === 'BLOCK').length,
        pipelineStageChanges: overnightEvents
          .filter((event) => event.payload.pipelineEventType === PipelineEventType.CONTACT_STAGE_CHANGED)
          .map((event) => ({
            contactId: event.contactId ?? '',
            contactName: String(event.payload.contactName ?? 'Contact'),
            fromStage: toPipelineStage(event.payload.fromStage),
            toStage: toPipelineStage(event.payload.toStage),
            changedAt: event.timestamp,
            agentType: event.agentType,
          })),
      },
      newResponses,
      todayAppointments,
      pipelineCounts,
      totalContacts: user.contacts.length,
      weeklyIPAs: state.weekly_ipa_count ?? 0,
      weeklyIPATarget: state.weekly_ipa_target ?? state.quota_weekly_target ?? 0,
      anchorStatement: typeof (user as any).goal_card === 'string' ? (user as any).goal_card : null,
      threeLawsStatus: {
        scores: {
          [ThreeLaw.GROW_DOWNLINE]: { law: ThreeLaw.GROW_DOWNLINE, score: state.three_law_grow_score ?? 0, trend: 'STABLE', lastActivityDate: null },
          [ThreeLaw.ENGAGE_BASE]: { law: ThreeLaw.ENGAGE_BASE, score: state.three_law_engage_score ?? 0, trend: 'STABLE', lastActivityDate: null },
          [ThreeLaw.INCREASE_WEALTH]: { law: ThreeLaw.INCREASE_WEALTH, score: state.three_law_wealth_score ?? 0, trend: 'STABLE', lastActivityDate: null },
        },
        compositeScore,
        level: compositeScore >= 80 ? ScoringLevel.MASTER : compositeScore >= 60 ? ScoringLevel.THRIVER : compositeScore >= 40 ? ScoringLevel.GROWER : compositeScore >= 20 ? ScoringLevel.SEED : ScoringLevel.DORMANT,
        neglectedLaws,
        requiresIntervention: neglectedLaws.length > 0,
      },
      inactivityAlerts: state.inactivity_level === 'NONE' ? [] : [{
        userId,
        level: state.inactivity_level as InactivityLevel,
        daysInactive: state.inactivity_days ?? 0,
        lastActivityDate: null,
        reengagementSequenceStep: 0,
        correctiveNudgesIssued: 0,
        uplineNotified: false,
      }],
      complianceFlags,
      daysSinceLastIPA: 0,
      actionQueue,
    });
  }

  async processPipelineEvent(event: PipelineEvent): Promise<AgentAction[]> {
    const eventActions = this.actionsForPipelineEvent(event);

    for (const action of eventActions) {
      await this.repository.createEvent({
        id: crypto.randomUUID(),
        agentType: action.agentType,
        actionType: action.actionType,
        userId: event.userId,
        contactId: event.contactId,
        timestamp: event.timestamp,
        payload: { ...event.payload, pipelineEventType: event.type, pipelineEventId: event.id },
        compliancePassed: true,
      });
      await this.repository.createAction(action);
    }

    return eventActions;
  }

  private actionsForPipelineEvent(event: PipelineEvent): AgentAction[] {
    const base = {
      pipelineEventType: event.type,
      pipelineEventId: event.id,
      contactName: event.payload.contactName,
      requiresHumanApproval: true,
      estimatedMinutes: 2,
    };

    switch (event.type) {
      case PipelineEventType.CONTACT_ADDED:
        return [createAgentAction({
          userId: event.userId,
          contactId: event.contactId,
          agentType: AgentType.PROSPECTING,
          actionType: AgentActionType.DRAFT_FIRST_TOUCH,
          payload: { ...base, description: 'Review new warm-market contact and approve first-touch outreach.' },
        })];
      case PipelineEventType.CONTACT_STAGE_CHANGED:
        return [createAgentAction({
          userId: event.userId,
          contactId: event.contactId,
          agentType: event.payload.toStage === PipelineStage.ACTIVATED ? AgentType.POST_SALE_NURTURE : AgentType.PRE_SALE_NURTURE,
          actionType: event.payload.toStage === PipelineStage.ACTIVATED ? AgentActionType.SCHEDULE_CHECK_IN : AgentActionType.SEND_NURTURE_MESSAGE,
          payload: { ...base, fromStage: event.payload.fromStage, toStage: event.payload.toStage, description: 'Stage change detected; queue the next relationship-first follow-up.' },
        })];
      case PipelineEventType.RESPONSE_RECEIVED:
        return [createAgentAction({
          userId: event.userId,
          contactId: event.contactId,
          agentType: AgentType.PRE_SALE_NURTURE,
          actionType: AgentActionType.FLAG_READY_FOR_APPOINTMENT,
          payload: { ...base, messagePreview: event.payload.messagePreview, description: 'Response received; review readiness for appointment.' },
        })];
      case PipelineEventType.APPOINTMENT_REQUESTED:
        return [createAgentAction({
          userId: event.userId,
          contactId: event.contactId,
          agentType: AgentType.APPOINTMENT,
          actionType: AgentActionType.PROPOSE_APPOINTMENT,
          payload: { ...base, wp09Ready: true, description: 'Find a dual-calendar appointment window and prepare a confirmation request.' },
        })];
      case PipelineEventType.APPOINTMENT_CONFIRMED:
        return [createAgentAction({
          userId: event.userId,
          contactId: event.contactId,
          agentType: AgentType.REPORTING,
          actionType: AgentActionType.GENERATE_PIPELINE_SNAPSHOT,
          payload: { ...base, description: 'Appointment confirmed; update pipeline and daily briefing metrics.' },
        })];
      case PipelineEventType.INACTIVITY_DETECTED:
        return [createAgentAction({
          userId: event.userId,
          contactId: event.contactId,
          agentType: AgentType.INACTIVITY_REENGAGEMENT,
          actionType: AgentActionType.TRIGGER_REENGAGEMENT,
          payload: { ...base, description: 'Inactivity detected; prepare a re-engagement nudge.' },
        })];
      case PipelineEventType.QUOTA_MILESTONE_CHECK:
        return [createAgentAction({
          userId: event.userId,
          agentType: AgentType.QUOTA,
          actionType: AgentActionType.CHECK_MILESTONE_PROGRESS,
          payload: { ...base, description: 'Check quota pace and surface any gap.' },
        })];
      case PipelineEventType.THREE_LAW_NEGLECT:
        return [createAgentAction({
          userId: event.userId,
          agentType: AgentType.INACTIVITY_REENGAGEMENT,
          actionType: AgentActionType.ISSUE_CORRECTIVE_NUDGE,
          payload: { ...base, law: event.payload.law, description: 'Three Laws neglect detected; issue corrective nudge.' },
        })];
      case PipelineEventType.COMPLIANCE_EVENT:
        return [createAgentAction({
          userId: event.userId,
          contactId: event.contactId,
          agentType: AgentType.REPORTING,
          actionType: AgentActionType.COMPLIANCE_FLAG,
          payload: { ...base, complianceFlag: true, description: 'Compliance event requires review before delivery.' },
        })];
      default:
        return [createAgentAction({
          userId: event.userId,
          contactId: event.contactId,
          agentType: AgentType.REPORTING,
          actionType: AgentActionType.LOG_AGENT_EVENT,
          payload: { ...base, description: 'Unclassified pipeline event logged for Mission Control review.' },
        })];
    }
  }

  async processNextAction(userId: string): Promise<AgentAction | null> {
    const [next] = await this.repository.listPendingActions(userId, 1);
    if (!next) return null;

    await this.repository.updateActionStatus(next.id, AgentActionStatus.RUNNING);
    const result = {
      wp05Contract: this.buildWP05Contract(next),
      processedAt: new Date().toISOString(),
      deliveryStatus: 'READY_FOR_HUMAN_APPROVAL',
    };
    return this.repository.updateActionStatus(next.id, AgentActionStatus.COMPLETED, result);
  }

  async runDueAgents(userId: string): Promise<AgentAction[]> {
    const briefing = await this.getRepBriefing(userId);
    const processed: AgentAction[] = [];
    for (const action of briefing.actionQueue.slice(0, 5)) {
      const result = await this.processNextAction(userId);
      if (result) processed.push(result);
    }
    return processed;
  }

  getDailyBriefingScheduleContract(userId: string) {
    return {
      userId,
      scheduleName: 'daily-mission-control-briefing',
      localTime: '06:00',
      timezoneSource: 'user.profile.timezone',
      callable: 'missionControl.compileScheduledDailyBriefing(userId)',
      boundedMinutes: 5,
    };
  }

  async compileScheduledDailyBriefing(userId: string): Promise<DailyBriefing> {
    const briefing = await this.getRepBriefing(userId);
    await this.db.missionControlState.upsert({
      where: { user_id: userId },
      create: { user_id: userId, last_briefing_date: briefing.date },
      update: { last_briefing_date: briefing.date },
    });
    return briefing;
  }

  buildWP05Contract(action: AgentAction): WP05AgentIntentContract | null {
    if (!action.contactId) return null;
    return {
      agentType: action.agentType,
      actionType: action.actionType,
      contactId: action.contactId,
      userId: action.userId,
      messageContent: String(action.payload.message ?? action.payload.description ?? 'Relationship-first follow-up ready for review.'),
      channel: (action.payload.channel as WP05AgentIntentContract['channel']) ?? 'IN_APP',
      priority: Number(action.payload.priority ?? 1),
      requiresComplianceReview: true,
      suggestedSendTime: action.payload.dueBy ? String(action.payload.dueBy) : undefined,
    };
  }

  buildWP09AppointmentContract(action: AgentAction): WP09AppointmentContract | null {
    if (action.agentType !== AgentType.APPOINTMENT || !action.contactId) return null;
    return {
      appointmentId: action.id,
      repId: action.userId,
      uplineId: typeof action.payload.uplineId === 'string' ? action.payload.uplineId : undefined,
      contactId: action.contactId,
      scheduledTime: String(action.payload.scheduledTime ?? new Date().toISOString()),
      durationMinutes: Number(action.payload.durationMinutes ?? 30),
      type: 'INTRO',
      status: 'PENDING',
      repTimezone: String(action.payload.timezone ?? 'America/New_York'),
    };
  }

  filterByRoleVisibility(
    viewerRole: AgentViewRole,
    targetUserId: string,
    viewerUserId: string,
    data: Record<string, unknown>
  ): Record<string, unknown> {
    return enforceRoleVisibility(viewerRole, targetUserId, viewerUserId, data);
  }

  async getUplineDashboard(input: {
    uplineId: string;
    viewerRole: AgentViewRole;
  }): Promise<UplineDashboard> {
    const visibility = AGENT_ROLE_VISIBILITY[input.viewerRole];
    if (!visibility.canSeeTeamData) {
      return this.emptyUplineDashboard(input.uplineId);
    }

    const reps = await this.db.user.findMany({
      where: { upline_id: input.uplineId },
      include: { contacts: true },
    });

    const repSummaries: RepSummary[] = reps.map((rep: any) => {
      const counts = { ...DEFAULT_PIPELINE_COUNTS };
      for (const contact of rep.contacts ?? []) {
        const stage = toPipelineStage(contact.pipeline_stage);
        counts[stage] = (counts[stage] ?? 0) + 1;
      }
      const total = rep.contacts?.length ?? 0;
      return {
        repId: rep.id,
        repName: rep.name,
        paceStatus: total > 10 ? PaceStatus.ON_TRACK : PaceStatus.BEHIND,
        momentumScore: Math.min(100, total * 5),
        lastActivityDate: rep.updated_at ?? null,
        pipelineStageCounts: counts,
        appointmentsThisWeek: counts[PipelineStage.PIPELINE] ?? 0,
        threeLawScores: {
          scores: {
            [ThreeLaw.GROW_DOWNLINE]: { law: ThreeLaw.GROW_DOWNLINE, score: Math.min(100, total * 5), trend: 'STABLE', lastActivityDate: null },
            [ThreeLaw.ENGAGE_BASE]: { law: ThreeLaw.ENGAGE_BASE, score: Math.min(100, total * 4), trend: 'STABLE', lastActivityDate: null },
            [ThreeLaw.INCREASE_WEALTH]: { law: ThreeLaw.INCREASE_WEALTH, score: Math.min(100, total * 3), trend: 'STABLE', lastActivityDate: null },
          },
          compositeScore: Math.min(100, total * 4),
          level: total > 20 ? ScoringLevel.THRIVER : total > 10 ? ScoringLevel.GROWER : ScoringLevel.SEED,
          neglectedLaws: total < 5 ? [ThreeLaw.GROW_DOWNLINE] : [],
          requiresIntervention: total < 5,
        },
        inactivityLevel: total > 0 ? InactivityLevel.NONE : InactivityLevel.HIGH,
        pendingComplianceFlags: 0,
      };
    });

    const teamOverview: TeamOverview = {
      totalReps: repSummaries.length,
      activeReps: repSummaries.filter((rep) => rep.inactivityLevel === InactivityLevel.NONE).length,
      inactiveReps: repSummaries.filter((rep) => rep.inactivityLevel !== InactivityLevel.NONE).length,
      totalContacts: repSummaries.reduce((sum, rep) => sum + Object.values(rep.pipelineStageCounts).reduce((a, b) => a + b, 0), 0),
      totalAppointmentsThisWeek: repSummaries.reduce((sum, rep) => sum + rep.appointmentsThisWeek, 0),
      teamAgentRatio: 0,
      teamClosingRatio: 0,
      averageMomentumScore: repSummaries.length ? Math.round(repSummaries.reduce((sum, rep) => sum + rep.momentumScore, 0) / repSummaries.length) : 0,
    };

    return {
      uplineId: input.uplineId,
      teamOverview,
      repSummaries,
      teamInactivityAlerts: repSummaries
        .filter((rep) => rep.inactivityLevel !== InactivityLevel.NONE)
        .map((rep) => ({ userId: rep.repId, level: rep.inactivityLevel, daysInactive: 7, lastActivityDate: rep.lastActivityDate, reengagementSequenceStep: 3, correctiveNudgesIssued: 1, uplineNotified: true })),
      teamComplianceFlags: [],
      coachingInterventions: repSummaries
        .filter((rep) => rep.threeLawScores.requiresIntervention)
        .map((rep) => ({ id: crypto.randomUUID(), repId: rep.repId, repName: rep.repName, type: 'THREE_LAW_NEGLECT', severity: 'MEDIUM', message: `${rep.repName} needs a simple next action today.`, suggestedAction: 'Prompt the rep to add contacts or approve the top queued action.', createdAt: new Date() })),
      teamPaceIndicators: Object.fromEntries(repSummaries.map((rep) => [rep.repId, rep.paceStatus])),
    };
  }

  private emptyUplineDashboard(uplineId: string): UplineDashboard {
    return {
      uplineId,
      teamOverview: { totalReps: 0, activeReps: 0, inactiveReps: 0, totalContacts: 0, totalAppointmentsThisWeek: 0, teamAgentRatio: 0, teamClosingRatio: 0, averageMomentumScore: 0 },
      repSummaries: [],
      teamInactivityAlerts: [],
      teamComplianceFlags: [],
      coachingInterventions: [],
      teamPaceIndicators: {},
    };
  }
}

export const missionControl = new MissionControl();
