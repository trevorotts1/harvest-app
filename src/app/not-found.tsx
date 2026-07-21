'use client';

// T-57 R2 / MAJOR-M2 + AC-2-7 (uiux §2.4 deep-link law) — the root not-found boundary. "Unknown or
// expired deep links land on Today with an explanatory toast — never a 404, never a blank screen."
// Next.js renders this for any unmatched route. Rather than a dead 404, it shows the explanatory
// message and forwards to /today: a visible link (works with JS disabled / immediately) PLUS an
// auto-redirect so an unattended tab still lands on Today. Localized via `useT()` (EN+ES).

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useT } from '@/app/locale-context';
import styles from './not-found.module.css';

export default function NotFound() {
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    // Give the reader a moment to see WHY they were moved (AC-2-7's "explanatory toast"), then land
    // them on Today — never leave the dead-end route in the address bar.
    const timer = setTimeout(() => router.replace('/today'), 2500);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <main className={styles.page}>
      <div className={styles.card} role="status" aria-live="polite">
        <h1 className={styles.heading}>{t('notFound.heading')}</h1>
        <p className={styles.body}>{t('notFound.body')}</p>
        <Link href="/today" className={styles.cta}>
          {t('notFound.cta')}
        </Link>
      </div>
    </main>
  );
}
