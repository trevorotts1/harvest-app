/**
 * T-53 — i18n locale primitives (master-spec §17.5, uiux §6.2).
 *
 * "Spanish is the first non-English locale" — exactly two supported locales today. This module is
 * the single source of truth for what a "locale" is in this app; the Prisma `User.locale` column
 * (a bare nullable `String?`) is validated against `isLocale()` here, never trusted verbatim.
 */

export type Locale = 'en' | 'es';

export const DEFAULT_LOCALE: Locale = 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'es'];

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'es';
}

/** Human-readable label for the locale switcher (Me → Language, uiux §6.2). */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

/** BCP-47 tag used for `<html lang>` and `Intl`/date-number formatting (uiux §6.2 "es-US as the
 *  launch Spanish locale" — the platform i18n layer, never hand-formatted). */
export const LOCALE_BCP47: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-US',
};

/**
 * Parses an HTTP `Accept-Language` header and returns the best-supported locale, defaulting
 * sensibly to `DEFAULT_LOCALE` when the header is absent, unparsable, or names no supported
 * locale. This is the "detected" half of "LOCALE SWITCH: a way to select EN/ES (per-user or
 * detected), defaulting sensibly" — used the FIRST time a visitor is seen (no stored override yet,
 * no signed-in preference), never overriding an explicit choice afterward.
 *
 * Deliberately tolerant: a malformed header (stray commas, missing q-values, garbage tags) never
 * throws — worst case it falls through to the default, exactly the fail-safe direction this app
 * takes everywhere else (§17.7 "no screen ever renders blank ... or undefined").
 */
export function detectLocaleFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;

  type Ranked = { tag: string; q: number };
  const ranked: Ranked[] = [];

  for (const part of header.split(',')) {
    const [rawTag, ...params] = part.trim().split(';').map((s) => s.trim());
    if (!rawTag) continue;
    let q = 1;
    for (const p of params) {
      const m = /^q=([0-9.]+)$/i.exec(p);
      if (m) {
        const parsed = Number.parseFloat(m[1]);
        if (Number.isFinite(parsed)) q = parsed;
      }
    }
    ranked.push({ tag: rawTag.toLowerCase(), q });
  }

  ranked.sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const primary = tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/** Resolves the effective locale from, in priority order: an explicit per-user preference (DB), a
 *  stored client override, then browser/header detection, then the platform default. Each layer is
 *  optional; the first defined+valid one wins. Never throws — always resolves to a real Locale. */
export function resolveLocale(opts: {
  userPreference?: string | null;
  clientOverride?: string | null;
  detected?: string | null;
}): Locale {
  if (isLocale(opts.userPreference)) return opts.userPreference;
  if (isLocale(opts.clientOverride)) return opts.clientOverride;
  if (isLocale(opts.detected)) return opts.detected;
  return DEFAULT_LOCALE;
}
