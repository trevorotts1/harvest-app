import { NextRequest, NextResponse } from 'next/server';
import { missionControl } from '@/services/agent-layer';
import { AGENT_ROLE_VISIBILITY } from '@/types/agent-layer';

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  const userRole = (request.headers.get('x-user-role') ?? 'REP') as 'REP' | 'UPLINE' | 'RVP' | 'ADMIN';

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const briefing = await missionControl.getRepBriefing(userId);

    // Enforce role visibility
    const filtered = missionControl.filterByRoleVisibility(
      userRole,
      userId,
      userId,
      briefing as unknown as Record<string, unknown>
    );

    return NextResponse.json(filtered);
  } catch (error) {
    console.error("Briefing compilation error:", error);
    return NextResponse.json(
      { error: 'Failed to compile daily briefing' },
      { status: 500 }
    );
  }
}
