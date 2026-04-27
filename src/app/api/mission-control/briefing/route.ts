import { NextResponse } from 'next/server';
import { getDailyBriefing } from '../../../services/agent-layer/mission-control.service';

export async function GET(req: Request) {
  return NextResponse.json(await getDailyBriefing('mock-user'));
}
