'use client';

import { SessionProvider } from 'next-auth/react';

import { LocaleProvider } from './locale-context';

/**
 * Client-side Auth.js session context (T-04). Wraps the app in `layout.tsx` so any client
 * component can call `useSession()` / `signIn()` / `signOut()` from `next-auth/react` — the auth
 * page's login form (src/app/auth/page.tsx) is the first consumer.
 *
 * T-53 (master-spec §17.5 / uiux §6.2 i18n): `LocaleProvider` nests INSIDE `SessionProvider` — it
 * reads `useSession()` to reconcile a signed-in rep's persisted "Me -> Language" preference, so it
 * needs the session context to already be in scope.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LocaleProvider>{children}</LocaleProvider>
    </SessionProvider>
  );
}
