import { NextRequest, NextResponse } from 'next/server';
import { markActionComplete } from '@/services/harvest-method/action-queue.service';

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { actionId } = await request.json();
    if (!actionId) return NextResponse.json({ error: 'actionId is required' }, { status: 400 });

    const result = markActionComplete(userId, actionId);
    if (!result.available) return NextResponse.json({ available: false, reason: result.reason }, { status: 200 });
    return NextResponse.json({ success: result.success });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
