'use client';

// T-57 R2 (uiux §2.1/§2.2 — the linchpin fix) — the persistent 5-destination navigation shell.
// This is the CONTAINER: it reads the environment (current route, the signed-in role, the active
// locale) and hands them to the pure `AppNavView`. Mounted once in `src/app/layout.tsx` around
// `{children}`.
//
// COMPOSITION with T-58a's `template.tsx`: Next.js composes `layout > template > page`, so
// `layout.tsx` renders `<AppShell>{children}</AppShell>` where `{children}` is the template (if
// present) wrapping the page. This shell therefore wraps the template+page tree and coexists with
// it — it neither imports nor removes `template.tsx` (service-worker registration), which continues
// to run between this shell and each page exactly as before.
//
// On the marketing landing, `/auth`, onboarding, the Shift, and full-screen rituals the shell hides
// itself (uiux §2.2) and renders `{children}` bare, so those surfaces keep their own full-bleed
// layout.

import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

import { useLocale } from '@/app/locale-context';
import AppNavView from './AppNavView';
import { showsNavShell } from './navConfig';
import styles from './AppShell.module.css';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { t } = useLocale();

  if (!showsNavShell(pathname)) {
    return <>{children}</>;
  }

  // The role is read from the server-issued session (next-auth JWT/session claims, see
  // src/types/next-auth.d.ts) — the client cannot forge it, and showing/hiding the Team link is a
  // pure affordance layered on top of the real server-side RBAC on every /team route.
  const role = session?.user?.role;

  return (
    <div className={styles.shell}>
      <AppNavView pathname={pathname ?? ''} role={role} t={t} />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
