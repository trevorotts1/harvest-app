import { NextRequest, NextResponse } from 'next/server';
import { generatePrioritizedQueue } from '@/services/harvest-method/method.service';

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = generatePrioritizedQueue(userId);
    if (!result.available) return NextResponse.json({ available: false, reason: result.reason }, { status: 200 });
    return NextResponse.json(result.queue);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
