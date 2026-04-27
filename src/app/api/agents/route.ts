import { NextResponse } from 'next/server';
import { getAgentInventory } from '../../../services/agent-layer/agent.service';

export async function GET(req: Request) {
  const userId = 'mock-user';
  return NextResponse.json(await getAgentInventory(userId));
}
