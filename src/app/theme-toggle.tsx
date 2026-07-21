'use client';

import { useEffect, useState } from 'react';

import { useT } from '@/app/locale-context';

/**
 * Real, working light/dark theme control (T-05, spec §1.2.2): "Theme
 * follows the OS by default with a manual override in Me -> Appearance."
 * This component is that override, implemented ahead of the full Me
 * surface (a later work package) so the token layer has a genuine,
 * working switch rather than tokens that only ever react to the OS.
 *
 * Cycles System -> Golden Hour (light) -> Pre-Dawn (dark) -> System.
 * "System" clears the override entirely so `prefers-color-scheme` in
 * tokens.css governs the semantic tokens again.
 */

const THEME_STORAGE_KEY = 'harvest-theme'; // must match theme-init-script.ts

type ThemeOverride = 'system' | 'light' | 'dark';

const CYCLE: ThemeOverride[] = ['system', 'light', 'dark'];

const LABEL_KEY: Record<ThemeOverride, string> = {
  system: 'theme.label.system',
  light: 'theme.label.goldenHour',
  dark: 'theme.label.preDawn',
};

function readStoredOverride(): ThemeOverride {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function applyOverride(next: ThemeOverride) {
  if (next === 'system') {
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    document.documentElement.setAttribute('data-theme', next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }
}

export function ThemeToggle() {
  const t = useT();
  const [override, setOverride] = useState<ThemeOverride>('system');

  // Reconcile with whatever the pre-hydration script already applied.
  useEffect(() => {
    setOverride(readStoredOverride());
  }, []);

  const handleClick = () => {
    const next = CYCLE[(CYCLE.indexOf(override) + 1) % CYCLE.length];
    applyOverride(next);
    setOverride(next);
  };

  const label = t(LABEL_KEY[override]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="theme-toggle"
      aria-label={t('theme.ariaLabelTemplate', { label })}
    >
      {t('theme.displayTemplate', { label })}
    </button>
  );
}
