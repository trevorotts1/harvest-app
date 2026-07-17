// uiux §5.1 O-2 — Identity. Name, photo (camera/library/skip → initials avatar), auth. The photo
// prompt says WHY ("Your face shows up in your launch kit — not in ads").

import styles from '../onboarding.module.css';

export interface IdentityStepProps {
  name: string;
  email: string;
  onNameChange?: (v: string) => void;
  onEmailChange?: (v: string) => void;
  onSkipPhoto?: () => void;
  onContinue?: () => void;
}

export default function IdentityStep({
  name,
  email,
  onNameChange,
  onEmailChange,
  onSkipPhoto,
  onContinue,
}: IdentityStepProps) {
  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>Let&rsquo;s get your details</h1>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="identity-name">
          Your name
        </label>
        <input
          id="identity-name"
          className={styles.input}
          value={name}
          onChange={(e) => onNameChange?.(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="identity-email">
          Email
        </label>
        <input
          id="identity-email"
          className={styles.input}
          type="email"
          value={email}
          onChange={(e) => onEmailChange?.(e.target.value)}
        />
      </div>
      <p className={styles.caption}>Your face shows up in your launch kit — not in ads.</p>
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onSkipPhoto}>
          Skip photo
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onContinue}
          disabled={!name.trim() || !email.trim()}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
