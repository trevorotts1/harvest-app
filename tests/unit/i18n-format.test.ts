// T-R32 (master-spec §17.5; uiux §6.2 "locale affects date/number/timezone formatting and quiet-hours
// logic") — the shared locale-aware date/number formatting layer (`src/lib/i18n/format.ts`). Proves:
//   (a) EN output is byte-identical to what every retrofitted hand-rolled `fmt()`/`formatUsd()`
//       helper already produced (regression safety across the subscription/data-rights/inbox/
//       community surfaces this task rewired to use it);
//   (b) ES (es-US) genuinely renders differently for DATES (month/day names, ordering) — proving the
//       fix is not a no-op;
//   (c) never throws / never blank on invalid or missing input (§17.7).
//
// Expected date/time strings are computed via a direct `Intl` call (same options, no `timeZone`
// override — matching `format.ts`'s own behavior of deferring to the runtime's local zone, exactly
// like every hand-rolled `fmt()` it replaced) rather than hardcoded literals, so this suite is
// correct under ANY machine timezone — it is testing the LOCALE-selection wiring (en-US vs es-US),
// not pinning a specific runner's local calendar day.
import { formatDate, formatDateTime, formatNumber, formatCurrencyUSD } from '@/lib/i18n/format';

const FIXED_ISO = '2026-07-15T14:30:00Z';
const FIXED_DATE = new Date(FIXED_ISO);

const expectDate = (bcp47: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(bcp47, opts).format(FIXED_DATE);

describe('formatDate — locale-aware, keyed to LOCALE_BCP47 (never a hardcoded en-US)', () => {
  test('en renders the "Month D, YYYY" shape every existing hand-rolled fmt() used', () => {
    expect(formatDate('en', FIXED_ISO)).toBe(expectDate('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  });

  test('es renders genuinely in Spanish — different month name AND word order, not a no-op', () => {
    const es = formatDate('es', FIXED_ISO);
    expect(es).toBe(expectDate('es-US', { year: 'numeric', month: 'long', day: 'numeric' }));
    expect(es).toContain('de julio de');
    expect(es).not.toBe(formatDate('en', FIXED_ISO));
  });

  test('accepts a Date object identically to an ISO string', () => {
    expect(formatDate('en', new Date(FIXED_ISO))).toBe(formatDate('en', FIXED_ISO));
  });

  test('null/undefined/invalid never throws and never renders blank — an em-dash placeholder', () => {
    expect(formatDate('en', null)).toBe('—');
    expect(formatDate('en', undefined)).toBe('—');
    expect(formatDate('en', 'not-a-date')).toBe('—');
    expect(formatDate('es', null)).toBe('—');
  });

  test('custom Intl.DateTimeFormatOptions are honored per-locale', () => {
    expect(formatDate('en', FIXED_ISO, { month: 'short', day: 'numeric' })).toBe(expectDate('en-US', { month: 'short', day: 'numeric' }));
    expect(formatDate('es', FIXED_ISO, { month: 'short', day: 'numeric' })).toBe(expectDate('es-US', { month: 'short', day: 'numeric' }));
  });
});

describe('formatDateTime — locale-aware date+time', () => {
  test('en renders "Mon D, ..., h:mm AM/PM" (matches every existing hand-rolled datetime fmt())', () => {
    expect(formatDateTime('en', FIXED_ISO)).toBe(
      expectDate('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    );
    expect(formatDateTime('en', FIXED_ISO)).toMatch(/AM|PM/);
  });

  test('es renders a lowercase, dotted day-period marker — genuinely different from en', () => {
    const es = formatDateTime('es', FIXED_ISO);
    expect(es).toBe(expectDate('es-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
    expect(es.toLowerCase()).toMatch(/a\.m\.|p\.m\./);
    expect(es).not.toBe(formatDateTime('en', FIXED_ISO));
  });

  test('null/undefined/invalid never throws, never blank', () => {
    expect(formatDateTime('en', null)).toBe('—');
    expect(formatDateTime('es', 'garbage')).toBe('—');
  });
});

describe('formatNumber — locale-aware plain number formatting', () => {
  test('renders thousands separators for both supported locales, never throws', () => {
    expect(formatNumber('en', 1234567)).toBe('1,234,567');
    expect(formatNumber('es', 1234567)).toBe('1,234,567'); // es-US shares en-US's US grouping convention
  });

  test('honors custom Intl.NumberFormatOptions', () => {
    expect(formatNumber('en', 0.5, { style: 'percent' })).toBe('50%');
  });
});

describe('formatCurrencyUSD — locale-aware whole-dollar USD formatting', () => {
  test('en renders exactly what every existing hand-rolled formatUsd()/formatCents() helper produced', () => {
    expect(formatCurrencyUSD('en', 125000)).toBe('$125,000');
  });

  test('es renders a valid USD figure too (es-US shares en-US\'s $-prefix convention for this locale pair) — never throws, never a raw number with no currency marker', () => {
    const es = formatCurrencyUSD('es', 125000);
    expect(es).toContain('125,000');
    expect(es).toMatch(/\$/);
  });

  test('defaults to zero fraction digits (whole dollars) unless overridden', () => {
    expect(formatCurrencyUSD('en', 42.99)).toBe('$43');
    expect(formatCurrencyUSD('en', 42.99, { maximumFractionDigits: 2 })).toBe('$42.99');
  });
});
