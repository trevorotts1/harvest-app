'use client';

import { SessionProvider } from 'next-auth/react';

/**
 * Client-side Auth.js session context (T-04). Wraps the app in `layout.tsx` so any client
 * component can call `useSession()` / `signIn()` / `signOut()` from `next-auth/react` — the auth
 * page's login form (src/app/auth/page.tsx) is the first consumer.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
