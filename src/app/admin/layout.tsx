// T-R56 — the /admin back-office console shell: ADMIN-only, following /team's exact shell
// convention (src/app/team/layout.tsx: `app-frame`/`sidebar`/`main`, a `<nav>` landmark of
// `side-link`s). Every `/admin/**` page ALSO re-authorizes itself against its own ADMIN-gated API
// route server-side (withRole([Role.ADMIN]) / withCapability('user_profile'|'cross_org', ...)) —
// this client-side role check is a reachability/UX affordance only, mirroring `today/page.tsx`'s
// own "the role comes from the server-issued session... /team pages still enforce RBAC
// server-side" posture: hiding the console for a non-admin here is never the real access check.
//
// `/admin` is a gated downstream page (src/lib/auth/onboarding-gate-edge.ts's
// GATED_DOWNSTREAM_PAGE_PREFIXES + src/middleware.ts's matcher both list it) — an authenticated
// but not-yet-onboarded admin is redirected to `/onboarding/resume` before ever reaching this
// layout, same as every other gated surface.

'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Role } from '@prisma/client';

import { useT } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { data: session, status } = useSession();

  // Honest, never-blank initial state (§17.7) while the session resolves — same posture as every
  // other role-gated surface in this app (e.g. today/page.tsx's `session?.user?.role` read).
  if (status === 'loading') {
    return (
      <div className="card panel">
        <p>{t('admin.layout.loading')}</p>
      </div>
    );
  }

  const role = session?.user?.role;
  if (role !== Role.ADMIN) {
    return (
      <div className="card panel">
        <span className="badge">{t('admin.layout.badge')}</span>
        {/* T-57 RG7 (SC 4.1.3) — a hard access-denial announced via StatusMessage (role=alert). */}
        <StatusMessage>{t('admin.layout.forbiddenBody')}</StatusMessage>
        <Link className="btn btn-secondary" href="/today">
          {t('admin.layout.forbiddenCta')}
        </Link>
      </div>
    );
  }

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <Link href="/today" className="brand">
          <span className="brand-mark">H</span>
          <span>{t('auth.brandName')}</span>
        </Link>
        <nav aria-label={t('admin.layout.navAria')}>
          <Link className="side-link" href="/admin">
            {t('admin.layout.overviewLink')}
          </Link>
          <Link className="side-link" href="/admin/users">
            {t('admin.layout.usersLink')}
          </Link>
          <Link className="side-link" href="/admin/signups">
            {t('admin.layout.signupsActivityLink')}
          </Link>
          <Link className="side-link" href="/admin/kill-switch">
            {t('admin.layout.killSwitchLink')}
          </Link>
          <Link className="side-link" href="/admin/audit">
            {t('admin.layout.auditLink')}
          </Link>
        </nav>
      </aside>
      <section className="main">{children}</section>
    </main>
  );
}
