import { NextRequest, NextResponse } from 'next/server';
import { OnboardingStep, STEP_ORDER, MIN_COMMITMENT_SCORE } from '@/types/onboarding';
import { onboardingService } from '@/services/onboarding/service';

// In-memory store for tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessions: any[] = [];

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { step, data } = body as { step: OnboardingStep; data: Record<string, unknown> };

    if (!step || !data) {
      return NextResponse.json(
        { error: 'step and data are required' },
        { status: 400 }
      );
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

    // Validate step progression
    const currentIdx = STEP_ORDER.indexOf(session.current_step);
    const submittedIdx = STEP_ORDER.indexOf(step);

    if (submittedIdx !== currentIdx) {
      return NextResponse.json(
        { error: `Expected step ${session.current_step}, received ${step}` },
        { status: 400 }
      );
    }

    // Business rule validation
    const validation = onboardingService.canProgressTo(session.current_step, {
      orgType: data.orgType as string | undefined,
      solutionNumber: data.solutionNumber as string | undefined,
      sevenWhys: data.sevenWhys as string[] | undefined,
      goalCard: data.goalCard as { primaryGoal: string; targetDate: string; commitmentLevel: number; motivationStatement: string } | undefined,
      intensityData: data.intensityData as { commitmentScore: number; weeklyHours: number; riskTolerance: 'LOW' | 'MEDIUM' | 'HIGH'; supportNeeds: string[] } | undefined,
    });

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Update session data
    if (step === OnboardingStep.REGISTER) {
      if (data.orgType) session.org_type = data.orgType;
      if (data.solutionNumber) session.solution_number = data.solutionNumber;
    }
    if (step === OnboardingStep.SEVEN_WHYS) {
      session.seven_whys = data.sevenWhys || null;
      // Also check intensity commitment gate if present
      if (data.intensityData) {
        const score = (data.intensityData as { commitmentScore: number }).commitmentScore;
        if (score < MIN_COMMITMENT_SCORE) {
          return NextResponse.json(
            { error: `Commitment score must be at least ${MIN_COMMITMENT_SCORE}/10 to proceed` },
            { status: 400 }
          );
        }
      }
    }
    if (step === OnboardingStep.GOAL_CARD) {
      session.goal_card = data.goalCard || null;
    }
    if (step === OnboardingStep.INTENSITY) {
      session.intensity_data = data.intensityData || null;
      const score = (data.intensityData as { commitmentScore: number })?.commitmentScore ?? 0;
      if (score < MIN_COMMITMENT_SCORE) {
        return NextResponse.json(
          { error: `Commitment score must be at least ${MIN_COMMITMENT_SCORE}/10 to complete onboarding` },
          { status: 400 }
        );
      }
    }

    // Advance step
    const nextStep = onboardingService.getNextStep(step);
    if (nextStep) {
      session.current_step = nextStep;
    }

    return NextResponse.json({
      currentStep: session.current_step,
      completed: session.completed,
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