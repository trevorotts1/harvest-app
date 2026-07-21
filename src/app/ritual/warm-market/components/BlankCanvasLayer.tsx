// uiux §5.4 Layer 1 — Blank Canvas. A blank paper surface (§1.1 item 4 ritual texture), the Vault
// count as a NUMBER ONLY (never names), free-typed names against a 20-dot constellation, soft-match
// against the Vault, and the §8.1 soft gate ("are you sure you want to stop at N?") — which asks
// once and NEVER hard-blocks (AC-5.4-1).

'use client';

import { useState } from 'react';

import styles from '../ritual.module.css';
import { useT } from '@/app/locale-context';

export const CONSTELLATION_SIZE = 20;

export interface BlankCanvasDraftEntry {
  typedName: string;
  matched: boolean;
  /** Present only when `matched` — the soft-matched Vault contact id (§5.4 Layer 1). */
  contactId?: string;
}

export interface BlankCanvasLayerProps {
  vaultCount: number;
  entries: BlankCanvasDraftEntry[];
  onAddName: (name: string) => void;
  /** True once the rep has tapped "That's my list" with < 5 names and the soft gate is showing. */
  softGateOpen: boolean;
  onRequestFinish: () => void;
  onConfirmSoftGate: () => void;
  onKeepAdding: () => void;
  flipping?: boolean;
}

export default function BlankCanvasLayer({
  vaultCount,
  entries,
  onAddName,
  softGateOpen,
  onRequestFinish,
  onConfirmSoftGate,
  onKeepAdding,
  flipping = false,
}: BlankCanvasLayerProps) {
  const t = useT();
  const [draft, setDraft] = useState('');

  function submitName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAddName(trimmed);
    setDraft('');
  }

  const dots = Array.from({ length: CONSTELLATION_SIZE }, (_, i) => entries[i]);

  return (
    <section
      className={`${styles.paper} ${flipping ? styles.paperFlipping : ''}`}
      aria-label={t('ritual.blankCanvas.sectionAria')}
    >
      <p className={styles.eyebrow}>{t('ritual.blankCanvas.eyebrow')}</p>

      <p className={styles.vaultCount}>{t('ritual.blankCanvas.vaultCount', { count: vaultCount })}</p>

      {/* Decorative ambient timer — never gates completion (§5.4 A11y). */}
      <div className={styles.ambientTimer} aria-hidden="true" />

      <h1 className={styles.visionPrompt}>
        {t('ritual.blankCanvas.visionPrompt')}
      </h1>

      <div className={styles.constellation} role="list" aria-label={t('ritual.blankCanvas.constellationAria')}>
        {dots.map((entry, i) => (
          <div
            key={i}
            role="listitem"
            className={`${styles.dot} ${entry ? (entry.matched ? styles.dotFilled : styles.dotUnmatched) : ''}`}
            title={
              entry
                ? entry.matched
                  ? t('ritual.blankCanvas.dotTitleMatched', { name: entry.typedName })
                  : t('ritual.blankCanvas.dotTitleUnmatched', { name: entry.typedName })
                : t('ritual.blankCanvas.dotTitleOpen')
            }
          >
            {entry ? entry.typedName.charAt(0).toUpperCase() : ''}
          </div>
        ))}
      </div>

      <form className={styles.nameForm} onSubmit={submitName}>
        <label htmlFor="blank-canvas-name" className={styles.srOnly}>
          {t('ritual.blankCanvas.typeNameLabel')}
        </label>
        <input
          id="blank-canvas-name"
          className={styles.nameInput}
          type="text"
          placeholder={t('ritual.blankCanvas.namePlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className={`${styles.btn} ${styles.btnSecondary}`}>
          {t('ritual.blankCanvas.addCta')}
        </button>
      </form>

      <ul className={styles.enteredList} aria-label={t('ritual.blankCanvas.enteredListAria')}>
        {entries.map((entry, i) => (
          <li key={i} className={styles.enteredChip}>
            {entry.typedName}
            {entry.matched ? t('ritual.blankCanvas.enteredMatchedSuffix') : t('ritual.blankCanvas.enteredUnmatchedSuffix')}
          </li>
        ))}
      </ul>

      {softGateOpen && (
        <div className={styles.softGate} role="alert">
          <p className={styles.softGateText}>
            {t('ritual.blankCanvas.softGateQuestion', { count: entries.length })}
          </p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onKeepAdding}>
              {t('ritual.blankCanvas.keepAddingCta')}
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onConfirmSoftGate}>
              {t('ritual.blankCanvas.confirmSoftGateCta')}
            </button>
          </div>
        </div>
      )}

      {!softGateOpen && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={entries.length === 0}
            onClick={onRequestFinish}
          >
            {t('ritual.blankCanvas.finishCta')}
          </button>
        </div>
      )}
    </section>
  );
}
