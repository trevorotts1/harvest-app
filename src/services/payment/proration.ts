// WP10 — Proration (§15.4; qc-checklist WP10 checkpoint 11 / uiux AC-5.8-7). "Proration on mid-cycle
// tier changes; annual prorated daily." A tier change previews the EXACT charge/credit before the
// user confirms — no surprise amounts (no dark pattern).
//
// Pure and deterministic: proration is computed by unused-time credit on the old plan minus used
// time, against the new plan's cost for the remaining period, prorated by the DAY.

import { formatCurrencyUSD } from '@/lib/i18n/format';
import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProrationInput {
  /** The current plan's full-period price in cents. */
  fromCents: number;
  /** The new plan's full-period price in cents. */
  toCents: number;
  /** Current billing period bounds (epoch ms). */
  periodStartMs: number;
  periodEndMs: number;
  /** When the change happens (epoch ms). */
  changeMs: number;
  /** T-57 BLOCKER-B8 fix — the rep's locale, so `summary` (below) is genuinely EN/ES rather than a
   *  hardcoded-English sentence around a hardcoded-`'en-US'` figure. Optional, defaulting to
   *  `DEFAULT_LOCALE`, so the one existing call site (`subscription.service.ts`'s
   *  `previewPlanChange`/`changePlan`, which does not yet thread a locale through) keeps compiling
   *  and produces byte-identical EN output — same non-breaking-default convention
   *  `HiddenEarningsReveal.tsx`'s own `locale` prop already established for this exact migration. */
  locale?: Locale;
}

export interface ProrationPreview {
  /** Whole days remaining in the current period (prorated daily — §15.4). */
  daysRemaining: number;
  daysInPeriod: number;
  /** Credit for unused time on the OLD plan (cents, ≥ 0). */
  creditCents: number;
  /** Charge for the remaining period on the NEW plan (cents, ≥ 0). */
  chargeCents: number;
  /** Net amount due now: `chargeCents - creditCents`. Positive = charge, negative = credit. */
  netCents: number;
  /** Human summary for the confirm screen (the exact amount shown BEFORE confirm — AC-5.8-7). */
  summary: string;
}

// T-57 BLOCKER-B8 fix — was `(abs / 100).toLocaleString('en-US', ...)`, a hardcoded literal that
// never varied with the rep's chosen locale. Routes through the real i18n format layer instead
// (`formatCurrencyUSD`), keyed to whichever locale the caller supplies.
function formatCents(locale: Locale, cents: number): string {
  return formatCurrencyUSD(locale, Math.abs(cents) / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Compute the proration for a mid-cycle tier change, prorated by the day (§15.4 "annual prorated
 * daily"). The credit is the unused fraction of the OLD plan; the charge is the same remaining
 * fraction of the NEW plan; the net is what's due now.
 */
export function computeProration(input: ProrationInput): ProrationPreview {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const daysInPeriod = Math.max(1, Math.round((input.periodEndMs - input.periodStartMs) / DAY_MS));
  const rawRemaining = Math.ceil((input.periodEndMs - input.changeMs) / DAY_MS);
  const daysRemaining = Math.min(daysInPeriod, Math.max(0, rawRemaining));

  const fraction = daysRemaining / daysInPeriod;
  const creditCents = Math.round(input.fromCents * fraction);
  const chargeCents = Math.round(input.toCents * fraction);
  const netCents = chargeCents - creditCents;

  let summary: string;
  if (netCents > 0) {
    summary = t(locale, 'billing.proration.dueTodaySummary', { amount: formatCents(locale, netCents), count: daysRemaining });
  } else if (netCents < 0) {
    summary = t(locale, 'billing.proration.creditAppliedSummary', { amount: formatCents(locale, netCents), count: daysRemaining });
  } else {
    summary = t(locale, 'billing.proration.noChargeSummary');
  }

  return { daysRemaining, daysInPeriod, creditCents, chargeCents, netCents, summary };
}
