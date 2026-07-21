// T-57 R3c-1 (MAJOR-A3, uiux §6.1 item 5 / §3.1/§3.3) — the Grove's "Three Laws sheet". Before this
// fix, `<Grove>` was purely decorative (no button, no onClick anywhere) and the caption text was the
// ONLY thing a rep — sighted or screen-reader — could ever learn about the three channels driving it;
// §6.1#5 explicitly promises "channel detail available on the Three Laws sheet", and that sheet did
// not exist. This is the minimal, spec-scoped sheet §6.1#5 calls for: a tappable Grove opens it,
// listing the three §3.1 channels (Grow/Engage/Wealth), each with its live value and the anatomy
// table's own plain-language description — not the fuller "momentum ring + weakest-Law action deep
// link" surface §3.3 separately describes (that is a bigger, cross-surface feature outside this
// build unit's file ownership; A3's own remediation note scopes the fix to exactly this sheet).
//
// A11y (keyboard/SR reachable, per this build's explicit requirement): a real `role="dialog"`
// surface, `aria-modal`, a labelled close control, Escape-to-close, and the close button receives
// focus the instant the sheet opens (`useEffect` below) — never a click-only affordance. Tokens
// only (T-05, §1) — no raw hex anywhere in this file or its CSS.

'use client';

import { useEffect, useRef } from 'react';

import styles from '../today.module.css';
import { useT } from '@/app/locale-context';

export interface GroveThreeLawsSheetProps {
  open: boolean;
  onClose: () => void;
  laws: { grow: number; engage: number; wealth: number };
}

export default function GroveThreeLawsSheet({ open, onClose, laws }: GroveThreeLawsSheetProps) {
  const t = useT();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the close control the instant the sheet opens — a keyboard/SR user lands somewhere real,
  // never on whatever happened to have focus before the tap (the Grove hero button itself, which
  // would otherwise leave a screen reader announcing nothing new).
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={styles.groveSheetBackdrop}
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className={styles.groveSheetPanel}
        role="dialog"
        aria-modal="true"
        aria-label={t('grove.sheet.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.groveSheetHeader}>
          <p className={styles.groveSheetTitle}>{t('grove.sheet.title')}</p>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.groveSheetCloseBtn}
            onClick={onClose}
            aria-label={t('composer.closeAria')}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <ul className={styles.groveSheetList}>
          {/* Channel LABELS reuse the existing, already-translated `today.laws.*` keys
              (AnchorHeader's own per-Law breakdown, §4.5) rather than re-declaring new ones —
              same three Law names, one translation each, no drift risk between the two surfaces. */}
          <li className={styles.groveSheetRow}>
            <div className={styles.groveSheetRowHeader}>
              <span className={styles.groveSheetChannel}>{t('today.laws.grow')}</span>
              <span className={styles.groveSheetValue}>{laws.grow}</span>
            </div>
            <p className={styles.groveSheetCaption}>{t('grove.sheet.grow.caption')}</p>
          </li>
          <li className={styles.groveSheetRow}>
            <div className={styles.groveSheetRowHeader}>
              <span className={styles.groveSheetChannel}>{t('today.laws.engage')}</span>
              <span className={styles.groveSheetValue}>{laws.engage}</span>
            </div>
            <p className={styles.groveSheetCaption}>{t('grove.sheet.engage.caption')}</p>
          </li>
          <li className={styles.groveSheetRow}>
            <div className={styles.groveSheetRowHeader}>
              <span className={styles.groveSheetChannel}>{t('today.laws.wealth')}</span>
              <span className={styles.groveSheetValue}>{laws.wealth}</span>
            </div>
            <p className={styles.groveSheetCaption}>{t('grove.sheet.wealth.caption')}</p>
          </li>
        </ul>
      </div>
    </div>
  );
}
