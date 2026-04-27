import { NextRequest, NextResponse } from 'next/server';
import { getMethodState } from '@/services/harvest-method/method.service';

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = getMethodState(userId);

    if (!result.available) {
      return NextResponse.json({ available: false, reason: result.reason }, { status: 200 });
    }

    return NextResponse.json(result.state);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}