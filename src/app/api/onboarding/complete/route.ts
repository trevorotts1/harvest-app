import { NextRequest, NextResponse } from 'next/server';
import { onboardingService } from '../../../services/onboarding/service';

// In-memory store for tests (shared reference with step route in real app)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessions: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const users: any[] = [];

export async function POST(request: NextRequest) {
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

    if (session.completed) {
      return NextResponse.json(
        { error: 'Onboarding already completed' },
        { status: 400 }
      );
    }

    // Check that we're at the INTENSITY step (last before complete)
    if (session.current_step !== 'INTENSITY' && session.current_step !== 'COMPLETE') {
      return NextResponse.json(
        { error: 'Cannot complete onboarding before reaching INTENSITY step' },
        { status: 400 }
      );
    }

    // Validate intensity data exists
    if (!session.intensity_data) {
      return NextResponse.json(
        { error: 'Intensity data is required before completing onboarding' },
        { status: 400 }
      );
    }

    const commitmentScore = session.intensity_data?.commitmentScore ?? 0;

    // Check commitment threshold
    if (commitmentScore < 5) {
      return NextResponse.json(
        { error: 'Commitment score must be at least 5/10 to complete onboarding' },
        { status: 400 }
      );
    }

    // Finalize: determine access tier
    const accessTier = onboardingService.determineAccessTier(commitmentScore);

    // Mark session completed
    session.completed = true;
    session.current_step = 'COMPLETE';

    // Update user with access tier and commitment score
    const user = users.find((u) => u.id === userId);
    if (user) {
      user.access_tier = accessTier;
      user.commitment_score = commitmentScore;
      user.updated_at = new Date().toISOString();
    }

    return NextResponse.json({
      completed: true,
      accessTier,
      commitmentScore,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Export for testing
export { sessions, users };