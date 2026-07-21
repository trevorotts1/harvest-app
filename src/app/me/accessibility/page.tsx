'use client';

// T-57 R2 / BLOCKER-A1 (WCAG 2.2 AA §6.1) — Me → Accessibility, the "Big Text" toggle. tokens.css
// (`--text-scale`, line 173) already drives every `--type-*-size` token, but before this build
// NOTHING ever set it ≠ 1, so the documented Big Text mode was unreachable. This page persists the
// choice to localStorage (key/value contract shared with
// src/app/text-scale-init-script.ts — the beforeInteractive init script that applies it before
// first paint, mirroring theme-init-script.ts / locale-init-script.ts) AND applies it live to
// `<html style="--text-scale">` on toggle, so it takes effect app-wide immediately, not just on the
// next load.
//
// Localized via `useT()` (EN+ES). Auth-/onboarding-gated by the middleware `/me/:path*` matcher.

import { useEffect, useState } from 'react';

import { useT } from '@/app/locale-context';
import { BIG_TEXT_SCALE, BIG_TEXT_STORAGE_KEY } from '@/app/text-scale-init-script';
import styles from './accessibility.module.css';

export default function AccessibilityPage() {
  const t = useT();
  const [bigText, setBigText] = useState(false);

  // Reconcile with the persisted value after mount (SSR renders the default-off state; the init
  // script has already applied the real value to the DOM before paint — same pattern as ThemeToggle).
  useEffect(() => {
    try {
      setBigText(window.localStorage.getItem(BIG_TEXT_STORAGE_KEY) === 'on');
    } catch {
      /* localStorage unavailable — the off default stands. */
    }
  }, []);

  function toggle() {
    const next = !bigText;
    setBigText(next);
    try {
      window.localStorage.setItem(BIG_TEXT_STORAGE_KEY, next ? 'on' : 'off');
    } catch {
      /* best-effort persistence — the live application below still applies for this session. */
    }
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--text-scale', next ? BIG_TEXT_SCALE : '1');
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>{t('accessibility.heading')}</h1>
        <p className={styles.subhead}>{t('accessibility.subhead')}</p>
      </header>

      <section className={styles.card}>
        <div className={styles.rowText}>
          <p className={styles.rowTitle}>{t('accessibility.bigTextTitle')}</p>
          <p className={styles.rowDesc}>{t('accessibility.bigTextDesc')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={bigText}
          aria-label={t('accessibility.bigTextTitle')}
          className={`${styles.toggle} ${bigText ? styles.toggleOn : ''}`.trim()}
          onClick={toggle}
        >
          <span className={styles.toggleKnob} aria-hidden="true" />
          <span className={styles.toggleState}>
            {bigText ? t('accessibility.bigTextOn') : t('accessibility.bigTextOff')}
          </span>
        </button>
      </section>
    </main>
  );
}
