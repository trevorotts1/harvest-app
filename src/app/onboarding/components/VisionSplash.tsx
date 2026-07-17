// uiux §5.1 O-1 — Vision splash. Pre-Dawn canvas, vision voice, ONE button, ZERO form fields
// (AC-5.1-1). The copy is verbatim from the spec.

import styles from '../onboarding.module.css';

export const VISION_COPY =
  'The people already in your phone represent hundreds of thousands of dollars in potential. ' +
  "We're about to show you exactly what that means — and then we're going to go get it for you.";

export interface VisionSplashProps {
  onBegin?: () => void;
}

export default function VisionSplash({ onBegin }: VisionSplashProps) {
  return (
    <section className={`${styles.step} ${styles.predawn}`} aria-labelledby="vision-title">
      <h1 id="vision-title" className={styles.visionTitle}>
        {VISION_COPY}
      </h1>
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnHarvest}`} onClick={onBegin}>
          Let&rsquo;s begin
        </button>
      </div>
      <div className={styles.visionSeed} aria-hidden="true" />
    </section>
  );
}
