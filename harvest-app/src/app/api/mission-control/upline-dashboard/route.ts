// GET /api/mission-control/upline-dashboard — Upline view team dashboard

import { NextRequest, NextResponse } from 'next/server';
import { missionControl } from '@/services/agent-layer';
import { AGENT_ROLE_VISIBILITY } from '@/types/agent-layer';

export async function GET(request: NextRequest) {
  const uplineId = request.headers.get('x-user-id');
  const viewerRole = (request.headers.get('x-user-role') ?? 'REP') as 'REP' | 'UPLINE' | 'RVP' | 'ADMIN';

  if (!uplineId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only roles with team data access can view upline dashboard
  const visibility = AGENT_ROLE_VISIBILITY[viewerRole];
  if (!visibility.canSeeTeamData) {
    return NextResponse.json(
      { error: 'Insufficient permissions for upline dashboard' },
      { status: 403 }
    );
  }

  try {
    const dashboard = await missionControl.getUplineDashboard({
      uplineId,
      viewerRole,
    });

    return NextResponse.json(dashboard);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load upline dashboard' },
      { status: 500 }
    );
  }
}