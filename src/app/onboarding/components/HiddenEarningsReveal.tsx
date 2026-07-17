// uiux §5.1 O-8 — the Hidden Earnings Reveal.
//
// Four load-bearing compliance/UX rules, all enforced structurally here:
//  1. SAFE HARBOR (§4.13): the FTC line renders INSIDE the same composition as the figure, in the
//     vision voice, screenshot-inseparable — never dismissible, never fine print.
//  2. ZERO-DATA GROWTH PATH (§18.5): with 0–3 contacts there is NO dollar figure at all (never a
//     `$0` shame moment, never `NaN`) — only the seeded-field growth copy + an add/import action.
//  3. NO SHARE (§5.1 O-8): there is no share affordance on this screen in v1. This component renders
//     no share control of any kind — an earnings composition must not leave the app un-chaperoned.
//  4. ONE SCREEN-READER UTTERANCE (§6.1): the visual composition is `aria-hidden`; a single
//     visually-hidden line carries the figure AND the safe harbor as ONE utterance — never separately.
//
// Values arrive already computed (WP02 universal formula / Primerica-calibrated multipliers, §8.4);
// this UI never does the math.

import styles from '../onboarding.module.css';

/** §4.13 / §5.1 O-8 — the exact FTC safe-harbor wording (visual form: two sentences). */
export const SAFE_HARBOR_LINE =
  'This is potential, not a promise. It depends on your effort, consistency, and market.';

/** Below this contact count, the Reveal shows the growth path — never a dollar figure (§18.5). */
export const ZERO_DATA_MAX_CONTACTS = 3;

export interface HiddenEarningsRevealProps {
  contactCount: number;
  /** Monthly potential value in whole USD — only rendered above the zero-data threshold. */
  monthlyValueUsd: number;
  estimatedAppointments: number;
  estimatedClients: number;
  onContinue?: () => void;
  onAddContacts?: () => void;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function HiddenEarningsReveal({
  contactCount,
  monthlyValueUsd,
  estimatedAppointments,
  estimatedClients,
  onContinue,
  onAddContacts,
}: HiddenEarningsRevealProps) {
  const isZeroData = contactCount <= ZERO_DATA_MAX_CONTACTS;

  if (isZeroData) {
    // Growth-path variant: no dollar figure, no `$`, no `NaN` — a seeded field, not a $0 shame moment.
    return (
      <section className={styles.reveal} aria-labelledby="reveal-zero-heading">
        <div className={styles.visionSeed} aria-hidden="true" />
        <h1 id="reveal-zero-heading" className={styles.visionTitle}>
          Your field is just getting planted.
        </h1>
        <p className={styles.revealZero}>
          As your community grows, so does this number. Add 20 people to see your field&rsquo;s potential.
        </p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnHarvest}`} onClick={onAddContacts}>
            Add people
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onContinue}>
            Continue
          </button>
        </div>
      </section>
    );
  }

  // The single screen-reader utterance (§6.1 O-8 narration script): figure + safe harbor as ONE line.
  const srUtterance =
    `From the ${contactCount} people in your community: an estimated ${estimatedAppointments} conversations, ` +
    `${estimatedClients} families you could help, and ${formatUsd(monthlyValueUsd)} of potential monthly value. ` +
    'This is potential, not a promise — it depends on your effort, consistency, and market.';

  return (
    <section className={styles.reveal} aria-labelledby="reveal-sr">
      {/* The one SR utterance — figure and disclaimer never announced separately. */}
      <p id="reveal-sr" className={styles.srOnly}>
        {srUtterance}
      </p>

      {/* Visual composition — decorative to screen readers (the SR line above is authoritative). */}
      <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)' }}>
        <p className={styles.revealEyebrow}>From the {contactCount} people in your field</p>
        <p className={styles.revealFigure}>{formatUsd(monthlyValueUsd)}</p>
        <p className={styles.revealStat}>{estimatedAppointments} conversations</p>
        <p className={styles.revealStat}>{estimatedClients} families you could help</p>
        {/* Safe harbor: same composition, vision voice, screenshot-inseparable, not dismissible. */}
        <p className={styles.safeHarbor}>{SAFE_HARBOR_LINE}</p>
      </div>

      {/* Exactly one action — no share affordance exists on this screen (§5.1 O-8). */}
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnHarvest}`} onClick={onContinue}>
          Go get it.
        </button>
      </div>
    </section>
  );
}
