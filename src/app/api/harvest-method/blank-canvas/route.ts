import { NextRequest, NextResponse } from 'next/server';
import { submitBlankCanvas } from '@/services/harvest-method/method.service';
import { BlankCanvasData } from '@/types/harvest-method';

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: BlankCanvasData = await request.json();

    if (!body.categories || !Array.isArray(body.categories)) {
      return NextResponse.json({ error: 'categories array is required' }, { status: 400 });
    }

    const result = submitBlankCanvas(userId, body);

    if (!result.available) {
      return NextResponse.json({ available: false, reason: result.reason }, { status: 200 });
    }

    return NextResponse.json(result.state);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}