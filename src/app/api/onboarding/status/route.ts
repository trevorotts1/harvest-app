import { NextRequest, NextResponse } from 'next/server';
import { OnboardingStep } from '../../../types/onboarding';

// In-memory store for tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessions: any[] = [];

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = sessions.find((s) => s.user_id === userId);

    if (!session) {
      return NextResponse.json(
        { error: 'Onboarding session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      currentStep: session.current_step,
      completed: session.completed,
      sevenWhys: session.seven_whys,
      goalCard: session.goal_card,
      intensityData: session.intensity_data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Export sessions for testing
export { sessions };