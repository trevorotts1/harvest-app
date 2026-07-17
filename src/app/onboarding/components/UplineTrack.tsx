// uiux §5.1 — the dense upline (Flow B) / RVP (Flow D) track. "Reuse the same shell with density,
// not cinema: no vision splash, no reveal; stacked efficient forms → FINRA/license validation status
// panel with pass/fail/blocked-pending states → … disclosures." A blocked license renders the hard-
// block honestly with a named next step (AC-5.1-12), routing to the compliance advisory queue.
//
// Consumes the authoritative wp01 track shell: `stepsForRole` (ordered steps + which step is
// licensure-gated) and `evaluateTrackCompletion` (the §16.5 hard-block, which itself calls T-13) —
// this UI never re-implements the licensure rule, it renders the engine's verdict.

import { Role } from '@prisma/client';

import type { LicensingState } from '@/services/compliance/licensing';
import {
  COMPLIANCE_ADVISORY_ROUTE,
  evaluateTrackCompletion,
  stepsForRole,
} from '@/services/onboarding/wp01/tracks';

import styles from '../onboarding.module.css';

const LICENSE_LABEL: Record<LicensingState, string> = {
  LICENSED: 'Cleared',
  PRE_LICENSING: 'In pre-licensing',
  UNLICENSED: 'Not started',
  LICENSE_EXPIRED: 'Expired',
};

export interface UplineTrackProps {
  role: Role;
  licensingState: LicensingState;
  onFinish?: () => void;
}

export default function UplineTrack({ role, licensingState, onFinish }: UplineTrackProps) {
  const steps = stepsForRole(role);
  const completion = evaluateTrackCompletion(role, licensingState);
  const blocked = !completion.allowed;

  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>Set up your team account</h1>
      <p className={styles.lede}>A few required steps — this takes just a few minutes.</p>

      <ol className={styles.denseList}>
        {steps.map((step) => {
          if (step.requiresLicensure) {
            const isLicensed = licensingState === 'LICENSED';
            const chipClass = isLicensed
              ? styles.statusPass
              : licensingState === 'LICENSE_EXPIRED'
                ? styles.statusBlocked
                : styles.statusPending;
            return (
              <li key={step.key} className={styles.denseStep}>
                <span>{step.label}</span>
                <span className={chipClass}>{LICENSE_LABEL[licensingState]}</span>
              </li>
            );
          }
          return (
            <li key={step.key} className={styles.denseStep}>
              <span>{step.label}</span>
              <span className={styles.caption}>Required</span>
            </li>
          );
        })}
      </ol>

      {blocked ? (
        <div className={styles.blockHelp} role="alert">
          <p className={styles.label}>We can&rsquo;t finish setup until your license clears.</p>
          <p>Here&rsquo;s who to contact — we&rsquo;ll route you to the compliance advisory team.</p>
          <div className={styles.actions}>
            <a className={`${styles.btn} ${styles.btnSecondary}`} href={COMPLIANCE_ADVISORY_ROUTE}>
              Contact compliance
            </a>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onFinish}>
            Finish setup
          </button>
        </div>
      )}
    </div>
  );
}
