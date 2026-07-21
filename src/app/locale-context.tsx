'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';

import { t as lookup, type TVars } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locale';

/**
 * T-53 — the client-side locale context (master-spec §17.5, uiux §6.2 "LOCALE SWITCH: a way to
 * select EN/ES (per-user or detected), defaulting sensibly").
 *
 * Mirrors `./theme-toggle.tsx`'s override/persistence convention (localStorage-first, reconciled
 * post-mount so SSR and the first client paint never mismatch — see `./locale-init-script.ts`),
 * with one addition theme doesn't need: a SIGNED-IN rep's choice also persists server-side
 * (`User.locale`, via `/api/settings/locale`) so "Me → Language" genuinely follows the rep across
 * devices, not just this browser. Resolution order on load: (1) a stored browser override, else
 * (2) browser-language detection (`navigator.languages`), else (3) `DEFAULT_LOCALE` — then, once a
 * session is known, the SERVER preference (if the rep ever set one) wins and overwrites the local
 * guess. This never blocks rendering — the local guess is applied immediately; the server round
 * trip only refines it (§17.7 "no screen ever renders blank ... or a spinner without narrative").
 */

const LOCALE_STORAGE_KEY = 'harvest-locale'; // must match locale-init-script.ts

export interface LocaleContextValue {
  locale: Locale;
  /** Switches the active locale. Applies immediately (state + `<html lang>` + localStorage); also
   *  best-effort persists to the signed-in rep's `User.locale` unless `persist: false` (used when
   *  we're APPLYING a value we just read FROM the server, to avoid a redundant write-back). */
  setLocale: (next: Locale, opts?: { persist?: boolean }) => void;
  t: (key: string, vars?: TVars) => string;
}

// T-R32 — exported (was module-private) SOLELY so tests can render a component tree under an
// explicit non-default locale (`<LocaleContext.Provider value={{ locale: 'es', ... }}>`) to prove
// real ES rendering for `useLocale()`/`useT()` consumers. This repo's Jest env has no jsdom (see
// this file's own header note on `renderToStaticMarkup`-only tests) — no `useEffect` ever runs in a
// static render, so `<LocaleProvider>`'s own browser-detection logic can never flip the locale in a
// test; a directly-supplied `Context.Provider` value, by contrast, IS read synchronously by
// `useContext` during a static render, with no effect required. Every existing consumer keeps using
// `useLocale()`/`useT()` unchanged — this only adds a second, test-only way to seed the context.
export const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const langs = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const lang of langs) {
    const primary = lang?.split('-')[0]?.toLowerCase();
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  const applyLocale = useCallback((next: Locale, opts?: { persist?: boolean }) => {
    setLocaleState(next);
    if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        /* localStorage unavailable (privacy mode, etc.) — locale still applies via React state. */
      }
    }
    if (opts?.persist !== false) {
      void fetch('/api/settings/locale', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      }).catch(() => {
        /* Best-effort server persistence (Me -> Language) — never blocks the immediate local switch. */
      });
    }
  }, []);

  // Reconcile with whatever the pre-hydration script / browser already implies. Runs once, after
  // mount, exactly like ThemeToggle's own reconciliation — see that component's comment for why.
  useEffect(() => {
    const stored = readStoredLocale();
    setLocaleState(stored ?? detectBrowserLocale());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A signed-in rep's server-persisted "Me -> Language" choice, once known, wins over the local
  // browser guess/override (idempotent no-op if it already agrees). Re-runs only when the signed-in
  // user identity changes, not on every render.
  useEffect(() => {
    if (!session?.user) return;
    fetch('/api/settings/locale')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { locale?: string | null } | null) => {
        if (body && isLocale(body.locale)) {
          applyLocale(body.locale, { persist: false });
        }
      })
      .catch(() => {
        /* Own preference is best-effort — the local guess already applied above stands. */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user && (session.user as { id?: string }).id]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: applyLocale,
      t: (key: string, vars?: TVars) => lookup(locale, key, vars),
    }),
    [locale, applyLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Stable fallback used when no `<LocaleProvider>` is mounted — never throws (§17.7 "no screen
 *  ever renders blank ... or a spinner without narrative" extends to "never crashes a render just
 *  because a component was mounted standalone"). This matters concretely, not just
 *  theoretically: several existing unit tests in this codebase render components like
 *  `ShiftView`/`VisionSplash`/`AnchorHeader` directly via `react-dom/server`'s
 *  `renderToStaticMarkup` (this repo's `testEnvironment: 'node'` has no jsdom/@testing-library,
 *  see jest.config.js), with NO `<Providers>` wrapper at all — exactly the same reason
 *  `useSession()` from `next-auth/react` already tolerates a missing `<SessionProvider>` in this
 *  codebase's test suite. Falling back to `DEFAULT_LOCALE` (English) here keeps every one of those
 *  tests passing unchanged, and is the correct real-world default anyway. */
const FALLBACK_CONTEXT_VALUE: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {
    /* no-op outside a mounted <LocaleProvider> — there is no state to update. */
  },
  t: (key: string, vars?: TVars) => lookup(DEFAULT_LOCALE, key, vars),
};

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  return ctx ?? FALLBACK_CONTEXT_VALUE;
}

/** Convenience alias for components that only need the translate function, not the full context. */
export function useT(): (key: string, vars?: TVars) => string {
  return useLocale().t;
}
