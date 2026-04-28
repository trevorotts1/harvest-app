import { NextRequest, NextResponse } from 'next/server';
import {
  AgentType,
  AgentStatus,
  DailyBriefing,
  AgentState,
  QueuedAction,
  ActionableInsight,
  WeeklyGoal,
  ThreeLawsViolation,
} from '@/types/agent-layer';
import { SAFE_HARBOR_DISCLAIMERS } from '@/types/compliance';

// ── Demo fallback data ────────────────────────────────────────
// When no real DB state exists for a user, these static values
// give the frontend something meaningful to render.

const DEMO_AGENT_STATES: AgentState[] = [
  {
    agentType: AgentType.PROSPECTING,
    status: AgentStatus.ACTIVE,
    lastRunAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    currentQueue: [
      {
        id: 'demo-aq-1',
        contactId: 'demo-contact-1',
        actionType: 'REACH_OUT',
        scheduledFor: new Date(),
        status: 'PENDING',
      },
    ],
  },
  {
    agentType: AgentType.NURTURE,
    status: AgentStatus.ACTIVE,
    lastRunAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    currentQueue: [],
  },
  {
    agentType: AgentType.APPOINTMENT,
    status: AgentStatus.SLEEPING,
    lastRunAt: null,
    currentQueue: [],
  },
  {
    agentType: AgentType.FOLLOWUP,
    status: AgentStatus.PAUSED,
    lastRunAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
    currentQueue: [],
  },
  {
    agentType: AgentType.REACTIVATION,
    status: AgentStatus.SLEEPING,
    lastRunAt: null,
    currentQueue: [],
  },
];

const DEMO_WEEKLY_GOAL: WeeklyGoal = {
  contactsReached: 23,
  contactsReachedTarget: 100,
  appointmentsSet: 3,
  appointmentsSetTarget: 10,
  followupsCompleted: 7,
  followupsCompletedTarget: 20,
};

const DEMO_PENDING_ACTIONS: QueuedAction[] = [
  {
    id: 'demo-pa-1',
    contactId: 'demo-contact-1',
    actionType: 'REACH_OUT',
    scheduledFor: new Date(),
    status: 'PENDING',
  },
  {
    id: 'demo-pa-2',
    contactId: 'demo-contact-3',
    actionType: 'FOLLOW_UP',
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    status: 'PENDING',
  },
];

const DEMO_VIOLATIONS: ActionableInsight[] = [
  {
    type: ThreeLawsViolation.NEGLECT,
    severity: 'HIGH',
    recommendation:
      'Your FOLLOWUP agent has not run in 72 hours. Re-activate it to avoid missing follow-up windows.',
    priority: 1,
  },
];

function buildDemoBriefing(): DailyBriefing {
  return {
    date: new Date().toISOString(),
    pendingActions: DEMO_PENDING_ACTIONS,
    agentStatuses: DEMO_AGENT_STATES,
    progressScore: 42,
    weeklyGoal: DEMO_WEEKLY_GOAL,
    violations: DEMO_VIOLATIONS,
  };
}

// ── Route handler ──────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');

  if (!userId) {
    return NextResponse.json(
      { error: 'Missing x-user-id header', safeHarbor: SAFE_HARBOR_DISCLAIMERS.income },
      { status: 401 },
    );
  }

  // In production this would query the DB for real state.
  // For demo / no-DB mode we always return rich fallback data
  // so the frontend has something useful to render.
  const briefing = buildDemoBriefing();

  return NextResponse.json({
    userId,
    briefing,
    _meta: {
      demo: true,
      hint: 'Data is demo fallback. Connect a database for live state.',
    },
  });
}
