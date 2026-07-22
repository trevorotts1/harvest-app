// WP10 — Cancellation flow, NO DARK PATTERNS (§15.4; qc-checklist WP10 checkpoint 11 / uiux
// AC-5.8-6). "Reachable in ≤2 taps, no support-contact requirement, alternatives (pause/downgrade)
// as equal-weight options, plain-labeled final action, access-until date + reactivation window
// stated; proration previews the exact amount before confirm."
//
// This module is the data/decision layer for that flow; the UI (src/app/me/subscription) renders it
// with the alternatives as EQUAL-WEIGHT buttons and the final action plainly labeled "Cancel
// subscription" (never a euphemism). Cancel is always end-of-period by default (access honored to
// the paid-through date) — the honest, non-punitive default.

import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

/** Reactivation window after cancellation, in days (§15.4 "reactivation within the retention window"). */
export const REACTIVATION_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CancellationMode = 'end_of_period' | 'immediate';

/** The equal-weight alternatives offered BEFORE cancel — never nagged, never hidden (AC-5.8-6). */
export type RetentionAlternative = 'pause' | 'downgrade' | 'cancel';

export interface CancellationFlowInput {
  /** Number of the member's open agent conversations, for the honest step-1 "state of the field". */
  openConversations: number;
  /** Whether a downgrade path applies (e.g. enterprise → individual). Pause always applies. */
  downgradeAvailable: boolean;
  /** Paid-through date (epoch ms) — the access-until date on end-of-period cancel. */
  currentPeriodEndMs: number | null;
  nowMs?: number;
  /** T-57 RG8 (i18n) — the rep's locale for `finalActionLabel`. Defaults to `DEFAULT_LOCALE`. */
  locale?: Locale;
}

export interface CancellationFlow {
  /** Step 1 — the honest state of the field (uiux §5.8). */
  openConversations: number;
  /** Step 2 — alternatives as EQUAL-WEIGHT options (order is presentation-neutral). */
  alternatives: RetentionAlternative[];
  /** Step 3 — reason selector is OPTIONAL (never a required gate to cancel). */
  reasonOptional: true;
  /**
   * Step 4 — the plainly-labeled final action. Never a euphemism (AC-5.8-6).
   *
   * T-57 RG8 (i18n; server-i18n-leak) — USED to be the hardcoded English literal type
   * `'Cancel subscription'` (a compile-time "never a euphemism" tripwire) composed with no path to
   * Spanish. Now resolved via the SAME catalog key the trigger button on `me/subscription/page.tsx`
   * already uses (`billing.cancelSubscription`, already real ES "Cancelar suscripción") — so the
   * trigger and the final confirm both show the identical, plainly-labeled, non-euphemistic text
   * in the rep's own locale. Widened to `string` since the literal-type contract now lives in the
   * catalog (both `en.json`/`es.json` values ARE audited by `guard-i18n.mjs`'s doctrine copy-lint),
   * not in the TS type.
   */
  finalActionLabel: string;
  /** The access-until date stated before confirm (end-of-period default). */
  accessUntilIso: string | null;
  reactivationWindowDays: number;
  /** Explicitly false — this flow NEVER requires contacting support (AC-5.8-6). */
  requiresSupportContact: false;
}

/** Build the cancellation flow's data. The alternatives always include pause + cancel; downgrade if available. */
export function buildCancellationFlow(input: CancellationFlowInput): CancellationFlow {
  const alternatives: RetentionAlternative[] = ['pause'];
  if (input.downgradeAvailable) alternatives.push('downgrade');
  alternatives.push('cancel');
  const locale = input.locale ?? DEFAULT_LOCALE;

  return {
    openConversations: input.openConversations,
    alternatives,
    reasonOptional: true,
    finalActionLabel: t(locale, 'billing.cancelSubscription'),
    accessUntilIso: input.currentPeriodEndMs !== null ? new Date(input.currentPeriodEndMs).toISOString() : null,
    reactivationWindowDays: REACTIVATION_WINDOW_DAYS,
    requiresSupportContact: false,
  };
}

export interface CancellationOutcome {
  /** When access actually ends. End-of-period = paid-through date; immediate = now. */
  accessUntilIso: string;
  /** Until when the member may reactivate and restore data (§15.4). */
  reactivateUntilIso: string;
  mode: CancellationMode;
}

/**
 * Resolve the concrete cancellation outcome. Default (end_of_period) honors the paid-through date —
 * the member keeps full function until then (no dark pattern: we don't cut access the instant they
 * cancel). Immediate ends access now (only if the member explicitly chooses it).
 */
export function resolveCancellationOutcome(
  mode: CancellationMode,
  currentPeriodEndMs: number | null,
  nowMs: number = Date.now()
): CancellationOutcome {
  const accessUntilMs =
    mode === 'immediate' ? nowMs : currentPeriodEndMs ?? nowMs;
  const reactivateUntilMs = accessUntilMs + REACTIVATION_WINDOW_DAYS * DAY_MS;
  return {
    accessUntilIso: new Date(accessUntilMs).toISOString(),
    reactivateUntilIso: new Date(reactivateUntilMs).toISOString(),
    mode,
  };
}
