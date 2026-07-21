// uiux §5.1 O-2 — Identity. Name, photo (camera/library/skip → initials avatar), auth. The photo
// prompt says WHY ("Your face shows up in your launch kit — not in ads").
//
// The photo-capture affordance (T-20) offers camera / choose-from-library / skip. There is no live
// upload pipeline here — "chosen" just records that the rep picked a source; whenever no photo has
// actually been chosen (the initial state, or after an explicit skip), the initials-avatar fallback
// renders in its place, so a rep's profile is never left with a blank/broken image slot. `photoState`
// is owned by the caller (the onboarding orchestrator), the same local-useState pattern as
// name/email/intensity/solutionNumber — this component stays a pure, controlled render.

import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

export type PhotoCaptureState = 'unset' | 'chosen' | 'skipped';

/** Initials for the avatar fallback: first letter of the first and last name tokens, uppercased; a
 *  single "?" when there's no name yet to derive initials from. */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

export interface IdentityStepProps {
  name: string;
  email: string;
  onNameChange?: (v: string) => void;
  onEmailChange?: (v: string) => void;
  /** O-2 photo-capture affordance state; defaults to 'unset' (no photo chosen yet — the
   *  initials-avatar fallback renders). */
  photoState?: PhotoCaptureState;
  onTakePhoto?: () => void;
  onChooseFromLibrary?: () => void;
  onSkipPhoto?: () => void;
  onContinue?: () => void;
}

export default function IdentityStep({
  name,
  email,
  onNameChange,
  onEmailChange,
  photoState = 'unset',
  onTakePhoto,
  onChooseFromLibrary,
  onSkipPhoto,
  onContinue,
}: IdentityStepProps) {
  const t = useT();
  const hasChosenPhoto = photoState === 'chosen';
  const initials = initialsFromName(name);

  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>{t('onboarding.identity.headline')}</h1>

      <div className={styles.avatarRow}>
        {hasChosenPhoto ? (
          <div className={styles.avatarPhoto} role="img" aria-label={t('onboarding.identity.photoAddedAria')}>
            <span className={styles.caption}>{t('onboarding.identity.photoAddedCaption')}</span>
          </div>
        ) : (
          <div className={styles.avatarInitials} role="img" aria-label={t('onboarding.identity.initialsAvatarAria', { initials })}>
            {initials}
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onTakePhoto}>
            {t('onboarding.identity.takePhotoCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onChooseFromLibrary}>
            {t('onboarding.identity.chooseFromLibraryCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onSkipPhoto}>
            {t('onboarding.identity.skipPhotoCta')}
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="identity-name">
          {t('onboarding.identity.nameLabel')}
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
          {t('onboarding.identity.emailLabel')}
        </label>
        <input
          id="identity-email"
          className={styles.input}
          type="email"
          value={email}
          onChange={(e) => onEmailChange?.(e.target.value)}
        />
      </div>
      <p className={styles.caption}>{t('onboarding.identity.photoCaption')}</p>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onContinue}
          disabled={!name.trim() || !email.trim()}
        >
          {t('onboarding.continueCta')}
        </button>
      </div>
    </div>
  );
}
