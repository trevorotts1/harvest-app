import { NextRequest, NextResponse } from 'next/server';
import { getActionQueue } from '@/services/harvest-method/action-queue.service';

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = getActionQueue(userId);
    if (!result.available) return NextResponse.json({ available: false, reason: result.reason }, { status: 200 });
    return NextResponse.json(result.queue);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
