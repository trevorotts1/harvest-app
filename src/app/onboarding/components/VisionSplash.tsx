// uiux §5.1 O-1 — Vision splash. Pre-Dawn canvas, vision voice, ONE button, ZERO form fields
// (AC-5.1-1). The copy is verbatim from the spec.
//
// T-53 (i18n, master-spec §17.5 / uiux §6.2): rendered text now flows through the catalog
// (`onboarding.vision.body`/`onboarding.vision.cta`, src/lib/i18n/messages/en.json). `VISION_COPY`
// stays exported, byte-identical to the EN catalog value, for any existing/future importer that
// wants the raw English string directly (e.g. a non-rendering doctrine/CFE scan) without needing
// to go through `t()`.

import { useT } from '@/app/locale-context';
import styles from '../onboarding.module.css';

export const VISION_COPY =
  'The people already in your phone represent hundreds of thousands of dollars in potential. ' +
  "We're about to show you exactly what that means — and then we're going to go get it for you.";

export interface VisionSplashProps {
  onBegin?: () => void;
}

export default function VisionSplash({ onBegin }: VisionSplashProps) {
  const t = useT();
  return (
    <section className={`${styles.step} ${styles.predawn}`} aria-labelledby="vision-title">
      <h1 id="vision-title" className={styles.visionTitle}>
        {t('onboarding.vision.body')}
      </h1>
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnHarvest}`} onClick={onBegin}>
          {t('onboarding.vision.cta')}
        </button>
      </div>
      <div className={styles.visionSeed} aria-hidden="true" />
    </section>
  );
}
