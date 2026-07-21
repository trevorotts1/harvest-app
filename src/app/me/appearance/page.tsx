'use client';

// T-57 RE-GATE dimension E [a9500c6d] — BLOCKER "M4-appearance": uiux §1.2.2 documents "Theme
// follows the OS by default with a manual override in Me -> Appearance," and `ThemeToggle`
// (src/app/theme-toggle.tsx) has been the real, working implementation of that override since T-05
// — cycling System -> Golden Hour (light) -> Pre-Dawn (dark) -> System, persisted to localStorage
// under the same key the beforeInteractive `theme-init-script.ts` reads before first paint. But it
// was only ever MOUNTED on the public marketing landing (`src/app/page.tsx`) and the nav-hidden dev
// gallery (`src/app/design-tokens/page.tsx`) — never anywhere inside the authenticated app. A
// signed-in rep had no in-app path to the override at all (re-gate finding, E [a9500c6d]).
//
// This page is that path: it hosts the EXISTING `ThemeToggle` by import — its cycle/persistence/
// init-script contract is untouched, nothing about theme logic is reimplemented here — behind the
// Me hub, mirroring the Me -> Accessibility page's card layout (`src/app/me/accessibility/page.tsx`).
//
// Localized via `useT()` (EN+ES). Auth-/onboarding-gated by the existing middleware `/me/:path*`
// matcher, exactly like every other /me sub-page.

import { ThemeToggle } from '@/app/theme-toggle';
import { useT } from '@/app/locale-context';
import styles from './appearance.module.css';

export default function AppearancePage() {
  const t = useT();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>{t('me.appearance.heading')}</h1>
        <p className={styles.subhead}>{t('me.appearance.subhead')}</p>
      </header>

      <section className={styles.card}>
        <div className={styles.rowText}>
          <p className={styles.rowTitle}>{t('me.appearance.themeRowTitle')}</p>
          <p className={styles.rowDesc}>{t('me.appearance.themeRowDesc')}</p>
        </div>
        <ThemeToggle />
      </section>
    </main>
  );
}
