// WP10 — Cancellation flow, NO DARK PATTERNS (§15.4; qc-checklist WP10 checkpoint 11 / uiux
// AC-5.8-6). "Reachable in ≤2 taps, no support-contact requirement, alternatives (downgrade) as
// equal-weight options, plain-labeled final action, access-until date + reactivation window stated;
// proration previews the exact amount before confirm."
//
// This module is the data/decision layer for that flow; the UI (src/app/me/subscription) renders it
// with the alternatives as EQUAL-WEIGHT buttons and the final action plainly labeled "Cancel
// subscription" (never a euphemism). Cancel is always end-of-period by default (access honored to
// the paid-through date) — the honest, non-punitive default.
//
// T-R42 (P2 cleanup, integration-reachability audit): 'pause' was REMOVED from
// `RetentionAlternative`/`buildCancellationFlow`'s alternatives — T-R41 already found (and
// documented at the ONE render site, src/app/me/subscription/page.tsx) that no pause capability
// exists anywhere in this codebase (no `PAUSED` in `SubscriptionStatus`, no pause method on
// `SubscriptionService`) and left the data layer's 'pause' entry in place only because the render
// site filtered it out and the ticket said never weaken an existing test. This unit finishes that
// burn-down at the source instead of leaving a permanent filter at the one call site: the data layer
// no longer offers an alternative it cannot honor at all (that would be the exact dark pattern
// qc-checklist WP10 checkpoint 11 forbids — offering a retention path that doesn't work).

import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

/** Reactivation window after cancellation, in days (§15.4 "reactivation within the retention window"). */
export const REACTIVATION_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CancellationMode = 'end_of_period' | 'immediate';

/** The equal-weight alternatives offered BEFORE cancel — never nagged, never hidden (AC-5.8-6).
 *  T-R42: 'pause' removed — no pause capability exists anywhere in this codebase (see module
 *  header), so it can never be an honest alternative to offer here. */
export type RetentionAlternative = 'downgrade' | 'cancel';

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

/** Build the cancellation flow's data. The alternatives always include cancel; downgrade if available. */
export function buildCancellationFlow(input: CancellationFlowInput): CancellationFlow {
  const alternatives: RetentionAlternative[] = [];
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
