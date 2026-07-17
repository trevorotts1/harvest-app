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

import styles from '../onboarding.module.css';

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
  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>Your data, your consent</h1>
      <p className={styles.lede}>
        One last thing before we finish setting up your business — we need your consent to process
        your personal data.
      </p>

      <div className={styles.consentRow}>
        <div className={styles.consentText}>
          <p className={styles.label}>{GDPR_CONSENT_LABEL}</p>
          <p className={styles.caption}>
            Not pre-selected — this is your explicit choice. Revocable any time.
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
          Continue
        </button>
      </div>
    </div>
  );
}
