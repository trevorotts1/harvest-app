/**
 * T-R32 (master-spec §17.5; uiux §6.2 "locale affects date/number/timezone formatting and quiet-hours
 * logic") — the shared, locale-aware date/number formatting layer every rep-facing surface should
 * route through instead of a bare `toLocaleString()`/`toLocaleDateString()` call (which silently
 * follows the BROWSER's own locale, ignoring the rep's in-app EN/ES choice) or a hardcoded
 * `'en-US'` literal (which never varies even once the rep switches to Spanish).
 *
 * `LOCALE_BCP47` (`src/lib/i18n/locale.ts`) already exists precisely for this — its own doc comment
 * says "used for `<html lang>` and `Intl`/date-number formatting ... the platform i18n layer, never
 * hand-formatted" — but nothing consumed it. This module is that consumption point: every function
 * here takes an explicit `Locale` (never reads ambient/browser state itself) and resolves it to the
 * right BCP-47 tag before calling the real `Intl` constructor, so EN callers get byte-identical
 * output to what they had before (Intl's `en-US` formatting hasn't changed), and ES callers get
 * genuinely Spanish-formatted dates (month/day names, ordering, AM/PM marker) for the first time —
 * numbers/currency render closer to identically between `en-US`/`es-US` specifically (both US-region
 * locales share CLDR's US grouping/decimal/currency-symbol conventions), which is a feature of this
 * app's locale choice (uiux §6.2 "es-US as the launch Spanish locale"), not a gap in this module.
 */
import { LOCALE_BCP47, type Locale } from './locale';

const DEFAULT_DATE_OPTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
const DEFAULT_DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

/** Formats an ISO string (or `Date`) as a locale-aware date — e.g. "July 15, 2026" (en-US) /
 *  "15 de julio de 2026" (es-US). Never throws: an invalid/absent input renders the same
 *  em-dash placeholder every existing local `fmt()` helper in this codebase already used for "no
 *  date yet" (§17.7 "no screen ever renders blank ... or undefined"). */
export function formatDate(
  locale: Locale,
  iso: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTS
): string {
  if (iso === null || iso === undefined) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE_BCP47[locale], opts).format(d);
}

/** Formats an ISO string (or `Date`) as a locale-aware date+time — e.g. "Jul 15, 9:30 AM" (en-US) /
 *  "15 jul, 9:30 a.m." (es-US — lowercase, dotted day-period marker). Same never-throws /
 *  never-blank contract as `formatDate`. */
export function formatDateTime(
  locale: Locale,
  iso: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = DEFAULT_DATETIME_OPTS
): string {
  if (iso === null || iso === undefined) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE_BCP47[locale], opts).format(d);
}

/** Formats a plain number locale-aware (thousands separators, decimal marks — both flip in
 *  meaningfully different ways for many locales, though `en-US`/`es-US` happen to share the
 *  `,`/`.` convention; the point is routing through the platform's own i18n layer rather than
 *  hand-building a string). */
export function formatNumber(locale: Locale, value: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALE_BCP47[locale], opts).format(value);
}

/** Formats a whole-dollar USD amount locale-aware — routes through `Intl.NumberFormat` keyed to
 *  the rep's locale rather than a hardcoded `'en-US'`. `es-US` (this app's launch Spanish locale —
 *  deliberately the US region, not `es-ES`/`es-MX`) happens to share `en-US`'s `$`-prefix/comma-
 *  grouping convention for USD, by CLDR design (uiux §6.2 "es-US as the launch Spanish locale") —
 *  the win here is architectural (one real i18n call site instead of N hand-rolled ones scattered
 *  across components) and forward-compatible with any future non-US Spanish locale, not a visible
 *  format change for USD today. Defaults to zero fraction digits (whole dollars), matching every
 *  existing hand-rolled `formatUsd`-style helper in this codebase's rep-facing surfaces. */
export function formatCurrencyUSD(locale: Locale, value: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALE_BCP47[locale], {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    ...opts,
  }).format(value);
}
