import NextAuth from 'next-auth';

import { authOptions } from '@/lib/auth/options';

// Auth.js (NextAuth v4) App Router catch-all handler (T-04, D-2 confirmed). Handles sign-in,
// sign-out, session, CSRF, and the Credentials provider's callback under /api/auth/*. Real
// business logic (password verification, five-role/org context, MFA hook points) lives in
// src/lib/auth/options.ts — this file is intentionally just the framework wiring.
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
