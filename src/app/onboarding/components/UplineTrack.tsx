// uiux §5.1 — the dense upline (Flow B) / RVP (Flow D) track. "Reuse the same shell with density,
// not cinema: no vision splash, no reveal; stacked efficient forms → FINRA/license validation status
// panel with pass/fail/blocked-pending states → … disclosures." A blocked license renders the hard-
// block honestly with a named next step (AC-5.1-12), routing to the compliance advisory queue.
//
// Consumes the authoritative wp01 track shell: `stepsForRole` (ordered steps + which step is
// licensure-gated) and `evaluateTrackCompletion` (the §16.5 hard-block, which itself calls T-13) —
// this UI never re-implements the licensure rule, it renders the engine's verdict.
//
// DUAL persona switcher (§6.2, roles.ts; §4.10 segmented-control pattern, T-20): a DUAL user's
// per-persona onboarding state is a T-20 UI concern — roles.ts owns the capability/data-isolation
// invariants (`personasForRole` / `baseRoleForPersona` / `canInPersona`), never re-implemented here.
// This component only CONSUMES `baseRoleForPersona` conceptually: while the switcher is on 'rep' it
// renders the REP base track; on 'upline' the UPLINE base track — never the DUAL union — at
// local-demo-state fidelity (a `useState`, no persistence). Non-DUAL roles never see the switcher and
// render exactly as before (their own role's track, unchanged).

import { useState } from 'react';

import { Role } from '@prisma/client';

import type { LicensingState } from '@/services/compliance/licensing';
import { baseRoleForPersona, type Persona } from '@/services/onboarding/wp01/roles';
import {
  COMPLIANCE_ADVISORY_ROUTE,
  evaluateTrackCompletion,
  stepsForRole,
} from '@/services/onboarding/wp01/tracks';

import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

// T-R32b — routed through the catalog's `onboarding.uplineTrack.license`/`.persona` keys instead of
// a hardcoded EN map (same fix as AnchorHeader's momentum-band label): these are plain object
// lookups (`LICENSE_LABEL[licensingState]`), never JSX text/attribute literals, so the
// `guard-no-literals-in-components.mjs` scanner cannot see them — but they were still genuinely
// un-i18n'd, unconditionally English even under an `es` locale.
const LICENSE_LABEL_KEY: Record<LicensingState, string> = {
  LICENSED: 'onboarding.uplineTrack.license.cleared',
  PRE_LICENSING: 'onboarding.uplineTrack.license.prelicensing',
  UNLICENSED: 'onboarding.uplineTrack.license.notStarted',
  LICENSE_EXPIRED: 'onboarding.uplineTrack.license.expired',
};

const PERSONA_LABEL_KEY: Record<Persona, string> = {
  rep: 'onboarding.uplineTrack.persona.rep',
  upline: 'onboarding.uplineTrack.persona.upline',
};

export interface UplineTrackProps {
  role: Role;
  licensingState: LicensingState;
  onFinish?: () => void;
  /** Which persona view a DUAL user's switcher starts on (ignored for non-DUAL roles). Defaults to
   *  'rep'. Exposed so each persona's rendered view is directly testable, the same pattern
   *  IntensityDial's controlled `value` uses for its positions. */
  initialPersona?: Persona;
}

export default function UplineTrack({ role, licensingState, onFinish, initialPersona = 'rep' }: UplineTrackProps) {
  const t = useT();
  const isDual = role === Role.DUAL;
  const [persona, setPersona] = useState<Persona>(initialPersona);
  // Non-DUAL roles are unaffected: effectiveRole === role, exactly the pre-existing behavior.
  const effectiveRole = isDual ? baseRoleForPersona(persona) : role;

  const steps = stepsForRole(effectiveRole);
  const completion = evaluateTrackCompletion(effectiveRole, licensingState);
  const blocked = !completion.allowed;

  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>{t('onboarding.uplineTrack.headline')}</h1>
      <p className={styles.lede}>{t('onboarding.uplineTrack.lede')}</p>

      {isDual ? (
        <div className={styles.dial} role="radiogroup" aria-label={t('onboarding.uplineTrack.personaAriaLabel')}>
          {(['rep', 'upline'] as const).map((p) => {
            const isSel = persona === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={isSel}
                className={`${styles.dialPos} ${isSel ? styles.dialPosSelected : ''}`}
                onClick={() => setPersona(p)}
              >
                {t(PERSONA_LABEL_KEY[p])}
              </button>
            );
          })}
        </div>
      ) : null}

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
                <span className={chipClass}>{t(LICENSE_LABEL_KEY[licensingState])}</span>
              </li>
            );
          }
          return (
            <li key={step.key} className={styles.denseStep}>
              <span>{step.label}</span>
              <span className={styles.caption}>{t('onboarding.uplineTrack.requiredLabel')}</span>
            </li>
          );
        })}
      </ol>

      {blocked ? (
        <div className={styles.blockHelp} role="alert">
          <p className={styles.label}>{t('onboarding.uplineTrack.blockedTitle')}</p>
          <p>{t('onboarding.uplineTrack.blockedBody')}</p>
          <div className={styles.actions}>
            <a className={`${styles.btn} ${styles.btnSecondary}`} href={COMPLIANCE_ADVISORY_ROUTE}>
              {t('onboarding.uplineTrack.contactComplianceCta')}
            </a>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onFinish}>
            {t('onboarding.uplineTrack.finishSetupCta')}
          </button>
        </div>
      )}
    </div>
  );
}
