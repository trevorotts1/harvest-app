// uiux §5.1 O-2 — Identity. Name, photo (camera/library/skip → initials avatar), auth. The photo
// prompt says WHY ("Your face shows up in your launch kit — not in ads").
//
// R-04 (refinements catalog 2026-07-28) — the photo-capture affordance is now a REAL file input
// (`type="file" accept="image/*"`) driven by three explicit SOURCE buttons: Camera
// (`capture="user"` so the OS opens the device camera), Photo library, and Browse files (both the
// plain non-capture input — the platform's own chooser resolves library on touch devices and the
// file browser/Downloads on desktop). Picking a file reports it upward via `onPhotoFileSelected`;
// the caller owns the photo state + object-URL preview (controlled, like name/email), and this
// component NEVER advances the step on its own — not on a pick, not on skip. There is no live
// upload pipeline here (the identity fields are already persisted at registration; there is no
// photo route) — "chosen" records that a REAL file was picked and renders its local preview;
// whenever no photo has actually been chosen (the initial state, or after an explicit skip), the
// initials-avatar fallback renders in its place, so a rep's profile is never left with a
// blank/broken image slot. `photoState` is owned by the caller (the onboarding orchestrator), the
// same local-useState pattern as name/email/intensity/solutionNumber — this component stays a
// pure, controlled render.

import { useRef, type ChangeEvent } from 'react';

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
  /** R-04 — the chosen file's name, for the "photo added" caption; null until a real file was
   *  picked. */
  photoFileName?: string | null;
  /** R-04 — the caller-owned object-URL preview of the chosen file (the caller mints and
   *  revokes it). */
  photoPreviewUrl?: string | null;
  /** R-04 — the REAL capture path: a file was picked from the camera / photo-library /
   *  browse-files source input. The caller records it; this component never advances on its
   *  own. */
  onPhotoFileSelected?: (file: File) => void;
  /** R-04 — remove the chosen photo (back to the initials-avatar fallback). */
  onRemovePhoto?: () => void;
  /** Explicit skip — records 'skipped' (initials-avatar fallback); the step does NOT advance
   *  (only Continue does). */
  onSkipPhoto?: () => void;
  onContinue?: () => void;
}

export default function IdentityStep({
  name,
  email,
  onNameChange,
  onEmailChange,
  photoState = 'unset',
  photoFileName = null,
  photoPreviewUrl = null,
  onPhotoFileSelected,
  onRemovePhoto,
  onSkipPhoto,
  onContinue,
}: IdentityStepProps) {
  const t = useT();
  const hasChosenPhoto = photoState === 'chosen';
  const initials = initialsFromName(name);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // R-04 — the source chooser. All three affordances drive the SAME standard file input
  // (`accept="image/*"`); Camera sets `capture="user"` so the OS opens the device camera, while
  // Photo library and Browse files open the plain picker, which the platform resolves per its own
  // capability (photo library on touch devices, the file browser/Downloads on desktop).
  function openPhotoSource(source: 'camera' | 'library' | 'files') {
    const input = photoInputRef.current;
    if (!input) return;
    if (source === 'camera') input.setAttribute('capture', 'user');
    else input.removeAttribute('capture');
    input.click();
  }

  function handlePhotoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file on a retry
    if (file) onPhotoFileSelected?.(file);
  }

  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>{t('onboarding.identity.headline')}</h1>

      <div className={styles.avatarRow}>
        {hasChosenPhoto ? (
          photoPreviewUrl ? (
            <div className={styles.avatarPhoto} role="img" aria-label={t('onboarding.identity.photoAddedAria')}>
              {/* R-04 — the preview is a caller-minted local blob: URL, which next/image cannot
                  serve (no optimizer pipeline for a runtime object URL) — plain <img>, exactly
                  like the launch-kit page's own user-photo render. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.avatarPhotoImg} src={photoPreviewUrl} alt="" />
            </div>
          ) : (
            <div className={styles.avatarPhoto} role="img" aria-label={t('onboarding.identity.photoAddedAria')}>
              <span className={styles.caption}>{t('onboarding.identity.photoAddedCaption')}</span>
            </div>
          )
        ) : (
          <div className={styles.avatarInitials} role="img" aria-label={t('onboarding.identity.initialsAvatarAria', { initials })}>
            {initials}
          </div>
        )}
        <div className={styles.actions}>
          {hasChosenPhoto ? (
            <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onRemovePhoto}>
              {t('onboarding.identity.removePhotoCta')}
            </button>
          ) : (
            <>
              <p className={styles.caption}>{t('onboarding.identity.photoSourceLabel')}</p>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => openPhotoSource('camera')}>
                {t('onboarding.identity.takePhotoCta')}
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => openPhotoSource('library')}>
                {t('onboarding.identity.chooseFromLibraryCta')}
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => openPhotoSource('files')}>
                {t('onboarding.identity.browseFilesCta')}
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onSkipPhoto}>
                {t('onboarding.identity.skipPhotoCta')}
              </button>
            </>
          )}
        </div>
      </div>

      {hasChosenPhoto && photoFileName ? (
        <p className={styles.caption}>{t('onboarding.identity.photoChosenCaption', { fileName: photoFileName })}</p>
      ) : null}

      {/* R-04 — the REAL upload source: one standard file input (`accept="image/*"`), visually
          hidden (not display:none, so the ref's programmatic .click() stays reliable
          cross-browser) — triggered ONLY by the three source buttons above via photoInputRef.
          Never an auto-advance: a selection only reports the file upward, and Continue is the
          only way past this step. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        aria-label={t('onboarding.identity.photoFileInputAria')}
        className={styles.srOnly}
        onChange={handlePhotoFileChange}
      />

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
