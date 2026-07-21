// uiux §5.1 O-8 — the Hidden Earnings Reveal.
//
// Four load-bearing compliance/UX rules, all enforced structurally here:
//  1. SAFE HARBOR (§4.13): the FTC line renders INSIDE the same composition as the figure, in the
//     vision voice, screenshot-inseparable — never dismissible, never fine print. Per §18.5 ("safe
//     harbor always") this applies to BOTH branches below — the zero-data growth path is NOT exempt.
//  2. ZERO-DATA GROWTH PATH (§18.5): with 0–3 contacts there is NO dollar figure at all (never a
//     `$0` shame moment, never `NaN`) — only the seeded-field growth copy + an add/import action +
//     the safe-harbor line (rule 1).
//  3. NO SHARE (§5.1 O-8): there is no share affordance on this screen in v1. This component renders
//     no share control of any kind — an earnings composition must not leave the app un-chaperoned.
//  4. ONE SCREEN-READER UTTERANCE (§6.1): the visual composition is `aria-hidden`; a single
//     visually-hidden line carries the figure AND the safe harbor as ONE utterance — never
//     separately — in BOTH the figure and growth-path branches.
//
// Values arrive already computed by the T-24 Hidden Earnings engine (WP02 universal formula /
// org-gated Primerica-calibrated multipliers, §8.4) — this UI never does the math; the constants and
// copy below are re-exported from that engine so there is exactly one source of truth for the exact
// wording every render-inseparability test checks against.

import styles from '../onboarding.module.css';
import {
  GROWTH_PATH_BODY,
  GROWTH_PATH_CONTACT_THRESHOLD,
  GROWTH_PATH_HEADLINE,
  SAFE_HARBOR_LINE,
  SAFE_HARBOR_LINE_SPOKEN,
} from '@/services/warm-market/hidden-earnings';
import { formatCurrencyUSD } from '@/lib/i18n/format';
import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

/** Re-exported from the engine (§4.13 / §5.1 O-8) — the exact FTC safe-harbor wording. */
export { SAFE_HARBOR_LINE };

/** Below this contact count, the Reveal shows the growth path — never a dollar figure (§18.5).
 *  Kept as an alias of the engine's `GROWTH_PATH_CONTACT_THRESHOLD` for callers already importing
 *  this name from the component. */
export const ZERO_DATA_MAX_CONTACTS = GROWTH_PATH_CONTACT_THRESHOLD;

export interface HiddenEarningsRevealProps {
  contactCount: number;
  /** Monthly potential value in whole USD — only rendered above the zero-data threshold. */
  monthlyValueUsd: number;
  estimatedAppointments: number;
  estimatedClients: number;
  onContinue?: () => void;
  onAddContacts?: () => void;
  /** T-R32 (§17.5 locale-aware number formatting) — optional so every existing caller (and every
   *  existing test, none of which pass this) keeps compiling and rendering byte-identical EN output;
   *  a caller that already knows the rep's locale (e.g. `OnboardingFlow.tsx` via `useLocale()`) can
   *  pass it through so the figure formats per-locale ("US$1,234" for es-US vs "$1,234" for en-US). */
  locale?: Locale;
}

// T-R32 (§17.5 locale-aware number formatting) — was `Intl.NumberFormat('en-US', ...)`, hardcoded
// regardless of the rep's chosen locale. `locale` defaults to `DEFAULT_LOCALE` so EN output (the
// only locale every existing caller/test exercises today) is byte-identical to before.
function formatUsd(value: number, locale: Locale): string {
  return formatCurrencyUSD(locale, value);
}

export default function HiddenEarningsReveal({
  contactCount,
  monthlyValueUsd,
  estimatedAppointments,
  estimatedClients,
  onContinue,
  onAddContacts,
  locale = DEFAULT_LOCALE,
}: HiddenEarningsRevealProps) {
  // §7.3/§18.5: 0–3 contacts is always the growth path. ALSO: the engine's own "never $0" guard
  // (hidden-earnings.ts `computeHiddenEarnings`) can fall back to the growth path at a HIGHER raw
  // contact count too — the floor-rounding chain legitimately computes `estimated_clients = 0` for
  // a wide band of counts above 3 (universal: 4–19; Primerica: 4–11) before a whole client first
  // clears. A caller that correctly passes the engine's own computed value here (0 whenever the
  // engine returned `kind: 'growth_path'`) is caught by the `monthlyValueUsd <= 0` half of this
  // check, so this component can never be made to render a literal `$0` no matter what raw
  // `contactCount` accompanies it.
  const isZeroData = contactCount <= ZERO_DATA_MAX_CONTACTS || monthlyValueUsd <= 0;

  if (isZeroData) {
    // Growth-path variant: no dollar figure, no `$`, no `NaN` — a seeded field, not a $0 shame
    // moment. §18.5 "safe harbor always" means this branch is NOT exempt from the disclaimer — the
    // one screen-reader utterance carries the growth copy AND the safe harbor together (rule 4),
    // exactly like the figure branch below.
    const zeroSrUtterance = `${GROWTH_PATH_HEADLINE} ${GROWTH_PATH_BODY} ${SAFE_HARBOR_LINE_SPOKEN}`;
    return (
      <section className={styles.reveal} aria-labelledby="reveal-zero-sr">
        <p id="reveal-zero-sr" className={styles.srOnly}>
          {zeroSrUtterance}
        </p>
        <div aria-hidden="true">
          <div className={styles.visionSeed} />
          <h1 className={styles.visionTitle}>{GROWTH_PATH_HEADLINE}</h1>
          <p className={styles.revealZero}>{GROWTH_PATH_BODY}</p>
          {/* Safe harbor: same composition, vision voice, screenshot-inseparable, not dismissible —
              present in the growth path too (§18.5). */}
          <p className={styles.safeHarbor}>{SAFE_HARBOR_LINE}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnHarvest}`} onClick={onAddContacts}>
            {t(locale, 'onboarding.hiddenEarnings.addPeopleCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onContinue}>
            {t(locale, 'onboarding.continueCta')}
          </button>
        </div>
      </section>
    );
  }

  // The single screen-reader utterance (§6.1 O-8 narration script): figure + safe harbor as ONE line.
  //
  // T-57 R4-residual2 (dimension-B i18n re-gate) — this WRAPPING sentence used to be a hardcoded
  // English template literal even for es-locale reps; the embedded currency figure (`formatUsd`, via
  // `formatCurrencyUSD(locale, ...)`, see above) was already locale-aware, but the words around it
  // were not. Each countable phrase now resolves through the catalog's CLDR one/other mechanism
  // (`onboarding.hiddenEarnings.srUtterance.*`, en.json/es.json) via its OWN independent `count` —
  // "person"/"people", "conversation"/"conversations", "family"/"families" (and their Spanish
  // equivalents) each pluralize on a DIFFERENT quantity (contactCount/estimatedAppointments/
  // estimatedClients), so this can't be one shared plural switch. `SAFE_HARBOR_LINE_SPOKEN` itself
  // stays appended verbatim and untranslated by design — it is the FTC-mandated safe-harbor copy
  // (hidden-earnings.ts's own header: "Verbatim; never paraphrased", §4.13/§0.5); only the
  // component-authored sentence WRAPPING it is this fix's target (mirrors that same file's own
  // `buildScreenReaderUtterance` doctrine note: this component, not the engine, is "the REP-facing
  // surface that actually needs [...] locale-aware currency" and, now, locale-aware prose around it).
  const srUtterance =
    `${t(locale, 'onboarding.hiddenEarnings.srUtterance.sentence', {
      intro: t(locale, 'onboarding.hiddenEarnings.srUtterance.communityIntro', { count: contactCount }),
      conversations: t(locale, 'onboarding.hiddenEarnings.srUtterance.conversationsPhrase', { count: estimatedAppointments }),
      families: t(locale, 'onboarding.hiddenEarnings.srUtterance.familiesPhrase', { count: estimatedClients }),
      value: formatUsd(monthlyValueUsd, locale),
    })} ${SAFE_HARBOR_LINE_SPOKEN}`;

  return (
    <section className={styles.reveal} aria-labelledby="reveal-sr">
      {/* The one SR utterance — figure and disclaimer never announced separately. */}
      <p id="reveal-sr" className={styles.srOnly}>
        {srUtterance}
      </p>

      {/* Visual composition — decorative to screen readers (the SR line above is authoritative). */}
      <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)' }}>
        <p className={styles.revealEyebrow}>{t(locale, 'onboarding.hiddenEarnings.eyebrow', { count: contactCount })}</p>
        <p className={styles.revealFigure}>{formatUsd(monthlyValueUsd, locale)}</p>
        <p className={styles.revealStat}>{t(locale, 'onboarding.hiddenEarnings.conversationsStat', { count: estimatedAppointments })}</p>
        <p className={styles.revealStat}>{t(locale, 'onboarding.hiddenEarnings.familiesStat', { count: estimatedClients })}</p>
        {/* Safe harbor: same composition, vision voice, screenshot-inseparable, not dismissible. */}
        <p className={styles.safeHarbor}>{SAFE_HARBOR_LINE}</p>
      </div>

      {/* Exactly one action — no share affordance exists on this screen (§5.1 O-8). */}
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnHarvest}`} onClick={onContinue}>
          {t(locale, 'onboarding.hiddenEarnings.goGetItCta')}
        </button>
      </div>
    </section>
  );
}
