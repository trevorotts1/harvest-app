// POST /api/agents/prospect — Run prospecting agent for a user

import { NextRequest, NextResponse } from 'next/server';
import { ProspectingAgent } from '@/services/agent-layer';
import { WP04AgentFeed } from '@/types/warm-market';

const prospectingAgent = new ProspectingAgent();

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const contacts: WP04AgentFeed[] = body.contacts ?? [];
    const dailyGoal: number = body.dailyGoal ?? 5;

    const prioritized = prospectingAgent.prioritizeProspects(contacts, dailyGoal);
    const emptyPool = prospectingAgent.detectEmptyPool(contacts);

    return NextResponse.json({
      agentType: prospectingAgent.agentType,
      prioritizedActions: prioritized,
      emptyPool,
      message: emptyPool
        ? 'No viable prospects found. Add contacts to your warm market to begin outreach.'
        : `${prioritized.length} prospects prioritized for today`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Prospecting agent execution failed' },
      { status: 500 }
    );
  }
}