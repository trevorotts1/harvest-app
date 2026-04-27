import { NextRequest, NextResponse } from 'next/server';
import { submitBackgroundMatching } from '@/services/harvest-method/method.service';
import { BackgroundMatchingData } from '@/types/harvest-method';

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: BackgroundMatchingData = await request.json();
    if (!body.matchScores) return NextResponse.json({ error: 'matchScores is required' }, { status: 400 });

    const result = submitBackgroundMatching(userId, body);
    if (!result.available) return NextResponse.json({ available: false, reason: result.reason }, { status: 200 });
    return NextResponse.json(result.state);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
