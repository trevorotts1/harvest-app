// uiux §5.1 (T-21R, §6.10-10) — GDPR consent capture: a dedicated micro-step, the final onboarding
// gate before completion (mirrors `OnboardingStep.CONSENT_CAPTURE` already being the LAST step in
// every role's `ROLE_STEP_MAP`, src/types/onboarding.ts, and `tracks.ts`'s `ADMIN_STEPS` already
// labeling a `consent_capture` key "GDPR consent capture" — this closes the gap for the REP cinematic
// track, where no O-screen existed for it at all).
//
// An explicit, affirmative act: the toggle defaults OFF/false and is never pre-checked — the same
// "local useState, no live wiring in THIS component" controlled-prop pattern as every other O-screen
// (IntensityDial, IdentityStep), and it reuses the EXACT toggle affordance/tokens the O-5
// `OutreachConsentToggle` already proved compliant (`role="switch"`, `.consentRow`/`.consentText`/
// `.toggle*` classes) rather than inventing a second consent-toggle visual pattern or a raw, unstyled
// checkbox. Continue stays disabled until consent is explicitly given (same "disabled until an
// explicit act" contract as O-4's intensity dial, AC-5.1-3).
//
// Granting/revoking the underlying `ComplianceConsent` record (via WP11's `ConsentManager`) and
// `User.gdpr_consent` happens server-side — `OnboardingFlow.tsx` calls `POST /api/onboarding/consent`
// on Continue. This component only renders the affordance and reports the explicit user act to its
// caller; it does not talk to the network itself.
//
// R-11 (refinements catalog, 2026-07-28; operator decision D4 no-avoids + D2 fully implement,
// 2026-08-10): the master spec's §16.3 ACs (explicit opt-in at signup, a consent record per data
// type, and the GDPR/CCPA-vs-FINRA deletion carve-out) require a DISTINCT, explicit GDPR consent
// step in the onboarding flow, while the uiux spec's O-1..O-9 enumeration omits one. The two specs
// are reconciled TO THE MASTER SPEC — this O-8.5 step (the rep track's final gate before the O-9
// handoff, already the last step in every role's `ROLE_STEP_MAP`) IS the required consent step. The
// copy below therefore carries the §16.3 content the thin original lacked: WHAT personal data is
// processed and why (the ledger the agents read/write), WHO it is for (the rep's own community
// building, never sold), and the deletion/FINRA-2210/3110 carve-out (ordinary data is deleted on
// request; communications required for regulatory recordkeeping are lawfully retained in a
// segregated archive — the §16.3 field-level split). The grant stays fail-closed: an explicit
// toggle act, never pre-checked, Continue disabled without it, and `POST /api/onboarding/complete`
// independently refuses completion without `User.gdpr_consent === true`
// (`evaluateConsentCompletionGate`). The uiux spec files in ~/Downloads are external — the
// reconciliation note lives here and in the refinements catalog, never in the repo.

import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

export interface GdprConsentStepProps {
  /** Current consent choice. Owned by the caller; defaults to false — an explicit affirmative act is
   *  required, this is never pre-checked. */
  consented: boolean;
  onConsentedChange?: (value: boolean) => void;
  onContinue?: () => void;
  /** True while the grant request is in flight — disables Continue to prevent a double-submit. */
  submitting?: boolean;
  /** Surfaced if the server-side grant failed — Continue never silently "succeeds" only locally. */
  error?: string | null;
}

export const GDPR_CONSENT_LABEL =
  'I consent to Harvest processing my personal data, per GDPR and the Privacy Policy.';

export default function GdprConsentStep({
  consented,
  onConsentedChange,
  onContinue,
  submitting = false,
  error = null,
}: GdprConsentStepProps) {
  const t = useT();
  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>{t('onboarding.gdprConsent.headline')}</h1>
      <p className={styles.lede}>
        {t('onboarding.gdprConsent.lede')}
      </p>

      {/* R-11 — the distinct, explicit GDPR/consent step copy (master spec §16.3): what is
          processed, who it is for, and the deletion/FINRA carve-out. All strings are catalog
          keys (en/es parity is asserted in onboarding-i18n.test.ts); the statutory consent
          statement below the toggle stays the single fixed EN string by design (the same
          recorded record in both locales — see GDPR_CONSENT_LABEL). */}
      <div className={styles.consentDetails}>
        <p className={styles.label}>{t('onboarding.gdprConsent.scopeTitle')}</p>
        <p>{t('onboarding.gdprConsent.scopeBody')}</p>
        <p className={styles.label}>{t('onboarding.gdprConsent.purposeTitle')}</p>
        <p>{t('onboarding.gdprConsent.purposeBody')}</p>
        <p className={styles.label}>{t('onboarding.gdprConsent.retentionTitle')}</p>
        <p>{t('onboarding.gdprConsent.retentionBody')}</p>
      </div>

      <div className={styles.consentRow}>
        <div className={styles.consentText}>
          <p className={styles.label}>{GDPR_CONSENT_LABEL}</p>
          <p className={styles.caption}>
            {t('onboarding.gdprConsent.notPreSelectedCaption')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={consented}
          aria-label={GDPR_CONSENT_LABEL}
          className={`${styles.toggle} ${consented ? styles.toggleOn : ''}`}
          onClick={() => onConsentedChange?.(!consented)}
        >
          <span className={styles.toggleKnob} />
        </button>
      </div>

      {error ? (
        <p className={styles.caption} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onContinue}
          disabled={!consented || submitting}
        >
          {t('onboarding.continueCta')}
        </button>
      </div>
    </div>
  );
}
