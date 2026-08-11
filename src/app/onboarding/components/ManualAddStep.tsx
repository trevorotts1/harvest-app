// R-13 (refinements catalog 2026-07-28) — the O-7 "Add one at a time" contact-entry FORM. The
// catalog row's observed loop: "Add one at a time" → "Your field is just getting planted / Add 20
// people" reveal screen → "Add people" → back to the "Phone import isn't available here" screen,
// cycling with NO reachable contact-entry UI (the old `onAddManually` handler in OnboardingFlow.tsx
// just did `setContactCount(1); advance()` — no form ever opened, nothing was ever persisted, and
// the reveal's "Add people" re-landed on the `unsupported` beat).
//
// This is the real form the row demands: name/phone/email fields, add-and-repeat (after a contact
// is persisted the form clears and stays open), a success confirmation, and a Done CTA that routes
// the rep ONWARD into the flow (the reveal) — never back to the phone-import screen. The component
// itself is stateless: the caller owns the draft fields, the submit POST, and the navigation
// (matching this codebase's canonical shell-owns-state pattern — see OnboardingFlow.tsx's own
// header). Every user-facing string ships through the i18n catalog (uiux §6.2, en/es).
//
// The form does not wrap the fields in a native `<form>` element by design: a submit-type button
// inside a form would fire a page-level POST navigation when clicked outside an onSubmit handler,
// so the buttons are plain `type="button"`s wired to the caller's handlers — the exact same
// pattern IdentityStep/OrgStep already use for their "Continue"/"Skip" CTAs.

import StatusMessage from '@/components/StatusMessage';
import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

export interface ManualAddStepProps {
  /** Current draft name — the caller owns it (resume-exact: going back re-renders with it intact). */
  name: string;
  onNameChange: (value: string) => void;
  /** Current draft phone. */
  phone: string;
  onPhoneChange: (value: string) => void;
  /** Current draft email. */
  email: string;
  onEmailChange: (value: string) => void;
  /** True while the draft contact's real ingestion POST is in flight — relabels and disables the
   *  "Add contact" button against a double-submit. */
  saving?: boolean;
  /** A real save failure — surfaced as an alert, never silently swallowed (the draft stays put for
   *  a retry). */
  saveError?: string | null;
  /** The most recently ADDED contact's display name — renders the polite success confirmation. */
  lastAddedName?: string | null;
  /** Submit the current draft (add-and-repeat): persists the contact, then resets the draft. */
  onAddContact?: () => void;
  /** Leave the manual form and move ONWARD in the flow (the O-8 reveal) — never back to the
   *  phone-import screen. */
  onDone?: () => void;
  /** Leave the manual form and return to the previous import beat (CSV / phone fallback). */
  onCancel?: () => void;
}

export default function ManualAddStep({
  name,
  onNameChange,
  phone,
  onPhoneChange,
  email,
  onEmailChange,
  saving = false,
  saveError = null,
  lastAddedName = null,
  onAddContact,
  onDone,
  onCancel,
}: ManualAddStepProps) {
  const t = useT();

  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>{t('onboarding.contactImport.manual.headline')}</h1>
      <p className={styles.lede}>{t('onboarding.contactImport.manual.lede')}</p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="manual-add-name">
          {t('onboarding.contactImport.manual.nameLabel')}
        </label>
        <input
          id="manual-add-name"
          type="text"
          className={styles.input}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('onboarding.contactImport.manual.namePlaceholder')}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="manual-add-phone">
          {t('onboarding.contactImport.manual.phoneLabel')}
        </label>
        <input
          id="manual-add-phone"
          type="tel"
          className={styles.input}
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          placeholder={t('onboarding.contactImport.manual.phonePlaceholder')}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="manual-add-email">
          {t('onboarding.contactImport.manual.emailLabel')}
        </label>
        <input
          id="manual-add-email"
          type="email"
          className={styles.input}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder={t('onboarding.contactImport.manual.emailPlaceholder')}
        />
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onAddContact}
          disabled={saving}
        >
          {saving
            ? t('onboarding.contactImport.manual.savingStatus')
            : t('onboarding.contactImport.manual.addCta')}
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onCancel}>
          {t('onboarding.contactImport.manual.cancelCta')}
        </button>
      </div>
      {lastAddedName ? (
        <StatusMessage tone="polite">
          {t('onboarding.contactImport.manual.addedStatus', { name: lastAddedName })}
        </StatusMessage>
      ) : null}
      {saveError ? <StatusMessage>{saveError}</StatusMessage> : null}
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnHarvest}`} onClick={onDone}>
          {t('onboarding.contactImport.manual.doneCta')}
        </button>
      </div>
    </div>
  );
}
