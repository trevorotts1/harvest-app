import { NextRequest, NextResponse } from 'next/server';
import { submitQualitiesFlip } from '@/services/harvest-method/method.service';
import { QualitiesFlipData } from '@/types/harvest-method';

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: QualitiesFlipData = await request.json();

    if (!body.strengths || !body.values || !body.skills) {
      return NextResponse.json(
        { error: 'strengths, values, and skills are required' },
        { status: 400 },
      );
    }

    const result = submitQualitiesFlip(userId, body);

    if (!result.available) {
      return NextResponse.json({ available: false, reason: result.reason }, { status: 200 });
    }

    return NextResponse.json(result.state);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}