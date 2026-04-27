import { NextRequest, NextResponse } from 'next/server';

// In-memory store for tests (swap with Prisma in production)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const users: any[] = [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'email and password are required' },
        { status: 400 }
      );
    }

    const user = users.find((u) => u.email === email);

    if (!user || user.password_hash !== password) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        org_type: user.org_type,
        access_tier: user.access_tier,
      },
      token: `mock-jwt-${user.id}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Export users for testing — same store as register
export { users };