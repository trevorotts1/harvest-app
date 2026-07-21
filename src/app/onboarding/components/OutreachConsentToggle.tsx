// uiux §5.1 O-5 completion / §6.4, AC-5.1-5 — the outreach-consent toggle.
//
// T-18's WhySession already defaults `use_in_outreach_consent` to false, changeable ONLY via the
// separate, explicit `setOutreachConsent` call — never as a side effect of a progress save (see
// src/services/onboarding/wp01/seven-whys/persistence.ts). This component is the UI surface for
// that consent: it renders after the Seven Whys anchor statement, defaults OFF, and is local
// demo-state only here (T-20) — no live persistence wiring, so flipping it in this build cannot
// itself change `use_in_outreach_consent` anywhere.

import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

export interface OutreachConsentToggleProps {
  /** Current consent value. Owned by the caller (the onboarding orchestrator), defaults to false —
   *  the same "local useState, no live wiring" pattern as intensity/solutionNumber. */
  value: boolean;
  onChange?: (value: boolean) => void;
}

// T-R32b — kept as the EN reference string existing tests/consumers import (unchanged byte-for-byte,
// and still exactly what renders under the default/EN locale, since it equals the catalog's
// `onboarding.outreachConsent.question` EN value below). The actual render now goes through
// `useT()` so a non-EN locale genuinely translates this, rather than this constant being spliced
// directly into JSX (which — unlike GDPR_CONSENT_LABEL/GDPR_CONSENT_LABEL's statutory-wording
// constraint — has no such requirement here; this is an ordinary consent QUESTION, not
// compliance-mandated verbatim text, and per this file's own header note isn't wired to any live
// persistence yet either).
export const OUTREACH_CONSENT_LABEL = 'May your agents reference your why in your outreach?';

export default function OutreachConsentToggle({ value, onChange }: OutreachConsentToggleProps) {
  const t = useT();
  return (
    <div className={styles.consentRow}>
      <div className={styles.consentText}>
        <p className={styles.label}>{t('onboarding.outreachConsent.question')}</p>
        <p className={styles.caption}>{t('onboarding.outreachConsent.caption')}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={t('onboarding.outreachConsent.question')}
        className={`${styles.toggle} ${value ? styles.toggleOn : ''}`}
        onClick={() => onChange?.(!value)}
      >
        <span className={styles.toggleKnob} />
      </button>
    </div>
  );
}
