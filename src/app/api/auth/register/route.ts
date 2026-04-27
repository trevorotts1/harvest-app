import { NextRequest, NextResponse } from 'next/server';
import { OnboardingStep } from '../../../types/onboarding';
import { onboardingService } from '../../../services/onboarding/service';

// In-memory store for tests (swap with Prisma in production)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const users: any[] = [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name, phone, orgType, solutionNumber, organizationId } = body;

    // Validation
    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'email, password, and name are required' },
        { status: 400 }
      );
    }

    // Check duplicate email
    if (users.find((u) => u.email === email)) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    // Primerica org gate: solution_number required
    if (orgType === 'PRIMERICA' && !solutionNumber) {
      return NextResponse.json(
        { error: 'Solution number is required for Primerica representatives' },
        { status: 400 }
      );
    }

    // If not Primerica, solution_number must be null
    const cleanSolutionNumber = orgType === 'PRIMERICA' ? solutionNumber : null;

    // Hash password (in production use bcrypt; simple hash for now)
    const passwordHash = password; // TODO: replace with proper bcrypt hash

    const user = {
      id: crypto.randomUUID(),
      email,
      password_hash: passwordHash,
      name,
      phone: phone || null,
      role: 'REP',
      org_type: orgType || 'EXTERNAL',
      solution_number: cleanSolutionNumber,
      upline_id: null,
      access_tier: 'FREE',
      commitment_score: 0,
      organization_id: organizationId || null,
      onboarding_step: OnboardingStep.REGISTER,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    users.push(user);

    // Create onboarding session
    const session = {
      id: crypto.randomUUID(),
      user_id: user.id,
      current_step: OnboardingStep.REGISTER,
      seven_whys: null,
      goal_card: null,
      intensity_data: null,
      completed: false,
      created_at: new Date().toISOString(),
    };

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          org_type: user.org_type,
          access_tier: user.access_tier,
        },
        onboarding: session,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Export users for testing
export { users };