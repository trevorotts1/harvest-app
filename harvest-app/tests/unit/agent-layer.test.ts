// WP04 tests for Agent Layer logic

import { ProspectingAgent } from '@/services/agent-layer/prospecting-agent';
import { AgentType, AgentExecutionMode, ThreeLaw, ScoringLevel, PipelineEventType, AgentActionType, AgentViewRole } from '@/types/agent-layer';
import { PipelineStage } from '@/types/warm-market';
import { InactivityReengagementAgent } from '@/services/agent-layer/inactivity-agent';
import { InactivityLevel } from '@/types/agent-layer';
import { MissionControl, InMemoryAgentStateRepository } from '@/services/agent-layer';

describe('ProspectingAgent', () => {
  const agent = new ProspectingAgent();

  it('should initialize with correct properties', () => {
    expect(agent.agentType).toBe(AgentType.PROSPECTING);
    expect(agent.executionMode).toBe(AgentExecutionMode.PARALLEL);
  });

  it('should identify prospectable contacts', () => {
    const contact = {
      contactId: '1',
      userId: 'user1',
      firstName: 'John',
      lastName: 'Doe',
      relationshipType: 'friend' as any,
      pipelineStage: PipelineStage.NEW,
      segmentScore: 50,
      lastContactDate: null,
      trustScore: null,
      lifeEvents: null,
      isRecruitTarget: false,
      isClient: false,
      daysSinceLastContact: null,
      consentSms: true,
      consentEmail: true,
    } as any;

    expect(agent.isProspectable(contact)).toBe(true);
  });
});

describe('InactivityReengagementAgent', () => {
  const agent = new InactivityReengagementAgent();

  it('should detect inactivity level correctly', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const state = agent.detectInactivity('user1', threeDaysAgo);
    expect(state.level).toBe(InactivityLevel.LOW);
    expect(state.daysInactive).toBe(3);
  });
});

describe('MissionControl critical command layer', () => {
  const makeDb = () => ({
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user1',
        name: 'Rep One',
        contacts: [
          { id: 'c1', user_id: 'user1', first_name: 'Ana', last_name: 'Friend', relationship_type: 'friend', pipeline_stage: 'NEW', segment_score: 82, last_contact_date: null, trust_score: 80, life_events: [], is_recruit_target: true, is_client: false, consent_given_at: new Date(), created_at: new Date(), updated_at: new Date() },
          { id: 'c2', user_id: 'user1', first_name: 'Ben', last_name: 'Work', relationship_type: 'work', pipeline_stage: 'PIPELINE', segment_score: 71, last_contact_date: new Date(), trust_score: 70, life_events: [], is_recruit_target: false, is_client: false, consent_given_at: new Date(), created_at: new Date(), updated_at: new Date() },
        ],
      }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'rep1', name: 'Rep One', updated_at: new Date(), contacts: [{ pipeline_stage: 'NEW' }, { pipeline_stage: 'PIPELINE' }] },
      ]),
    },
    missionControlState: {
      upsert: jest.fn().mockResolvedValue({
        user_id: 'user1',
        weekly_ipa_count: 3,
        weekly_ipa_target: 5,
        quota_weekly_target: 5,
        three_law_grow_score: 65,
        three_law_engage_score: 70,
        three_law_wealth_score: 55,
        inactivity_level: 'NONE',
        inactivity_days: 0,
      }),
    },
  });

  it('routes WP02 pipeline events into persistent agent actions', async () => {
    const repo = new InMemoryAgentStateRepository();
    const missionControl = new MissionControl(makeDb() as any, repo);

    const actions = await missionControl.processPipelineEvent({
      id: 'event1',
      type: PipelineEventType.CONTACT_ADDED,
      userId: 'user1',
      contactId: 'c1',
      timestamp: new Date(),
      payload: { contactName: 'Ana Friend' },
      consumedBy: [AgentType.PROSPECTING],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0].agentType).toBe(AgentType.PROSPECTING);
    expect(actions[0].actionType).toBe(AgentActionType.DRAFT_FIRST_TOUCH);
    await expect(repo.listPendingActions('user1')).resolves.toHaveLength(1);
  });

  it('builds Mission Control briefing from repository and WP02-style contact data', async () => {
    const repo = new InMemoryAgentStateRepository();
    const missionControl = new MissionControl(makeDb() as any, repo);

    await missionControl.processPipelineEvent({
      id: 'event2',
      type: PipelineEventType.RESPONSE_RECEIVED,
      userId: 'user1',
      contactId: 'c2',
      timestamp: new Date(),
      payload: { contactName: 'Ben Work', messagePreview: 'I can talk tomorrow.' },
      consumedBy: [AgentType.PRE_SALE_NURTURE],
    });

    const briefing = await missionControl.getRepBriefing('user1');
    expect(briefing.pipelineSnapshot.totalContacts).toBe(2);
    expect(briefing.pipelineSnapshot.byStage[PipelineStage.NEW]).toBe(1);
    expect(briefing.actionQueue).toHaveLength(1);
    expect(briefing.newResponses[0].contactName).toBe('Ben Work');
  });

  it('enforces REP role visibility and exposes daily 06:00 schedule contract', () => {
    const missionControl = new MissionControl(makeDb() as any, new InMemoryAgentStateRepository());
    const filtered = missionControl.filterByRoleVisibility('REP' as AgentViewRole, 'other-user', 'user1', { secret: true });
    expect(filtered).toEqual({});
    expect(missionControl.getDailyBriefingScheduleContract('user1')).toMatchObject({ localTime: '06:00', boundedMinutes: 5 });
  });

  it('builds upline dashboard from downline contact data', async () => {
    const missionControl = new MissionControl(makeDb() as any, new InMemoryAgentStateRepository());
    const dashboard = await missionControl.getUplineDashboard({ uplineId: 'upline1', viewerRole: 'UPLINE' });
    expect(dashboard.teamOverview.totalReps).toBe(1);
    expect(dashboard.teamOverview.totalContacts).toBe(2);
    expect(dashboard.repSummaries[0].pipelineStageCounts[PipelineStage.PIPELINE]).toBe(1);
  });
});
