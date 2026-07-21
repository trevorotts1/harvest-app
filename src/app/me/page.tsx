'use client';

// T-57 R2 (uiux §2.1 destination 5 / §5.8) — the Me hub. Before this build there was NO `/me` index
// (the three existing Me sub-surfaces — subscription, data-rights, language — were reachable ONLY
// via ad-hoc pills in the Today header). This is the index the persistent nav's "Me" destination
// lands on. Accessibility (Big Text) shipped in R2 (A1) as a live link.
//
// T-57 R3b: the Notifications placeholder R2 left ("comingSoon") is now a real link — that page
// ships in this build (MAJOR-D3). Intensity and Security are new hub entries this build also adds
// (E-M4 intensity-changeable-from-Me, E-M10 MFA enrollment + §16.4 sign-out-everywhere).
//
// Localized via `useT()` (EN+ES). Auth- and onboarding-gated by the existing middleware `/me/:path*`
// matcher, exactly like every /me sub-page.

import Link from 'next/link';

import { useT } from '@/app/locale-context';
import styles from './me.module.css';

interface HubItem {
  href: string;
  titleKey: string;
  descKey: string;
}

const HUB_ITEMS: readonly HubItem[] = [
  { href: '/me/accessibility', titleKey: 'me.accessibilityTitle', descKey: 'me.accessibilityDesc' },
  { href: '/me/notifications', titleKey: 'me.notificationsTitle', descKey: 'me.notificationsDesc' },
  { href: '/me/intensity', titleKey: 'me.intensity.hubTitle', descKey: 'me.intensity.hubDesc' },
  { href: '/me/language', titleKey: 'me.languageTitle', descKey: 'me.languageDesc' },
  { href: '/me/subscription', titleKey: 'me.subscriptionTitle', descKey: 'me.subscriptionDesc' },
  { href: '/me/data-rights', titleKey: 'me.dataRightsTitle', descKey: 'me.dataRightsDesc' },
  { href: '/me/security', titleKey: 'me.security.hubTitle', descKey: 'me.security.hubDesc' },
];

export default function MePage() {
  const t = useT();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>{t('me.heading')}</h1>
        <p className={styles.subhead}>{t('me.subhead')}</p>
      </header>

      <ul className={styles.list}>
        {HUB_ITEMS.map((item) => {
          const title = t(item.titleKey);
          const desc = t(item.descKey);
          return (
            <li key={item.href}>
              <Link className={styles.card} href={item.href} data-me-item={item.href}>
                <div className={styles.cardText}>
                  <span className={styles.cardTitle}>{title}</span>
                  <span className={styles.cardDesc}>{desc}</span>
                </div>
                <span className={styles.chevron} aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
