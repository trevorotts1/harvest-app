// uiux §5.1 O-9 — the First 48 handoff. `gated_complete` fires the 48-hour countdown; the Grove
// plants its seed on-screen; one button lands on Today's First-48 state (AC-5.1-10).

import styles from '../onboarding.module.css';

export interface First48HandoffProps {
  onShowToday?: () => void;
}

export default function First48Handoff({ onShowToday }: First48HandoffProps) {
  return (
    <section className={styles.step} aria-labelledby="first48-title">
      <div className={styles.stepInner}>
        <div className={styles.mound} aria-hidden="true" />
        <h1 id="first48-title" className={styles.headline}>
          Your field is planted.
        </h1>
        <p className={styles.lede}>
          Three introductions in 48 hours — that&rsquo;s the whole first mission.
        </p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnHarvest}`} onClick={onShowToday}>
            Show me Today
          </button>
        </div>
      </div>
    </section>
  );
}
