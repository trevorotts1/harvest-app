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
//
// T-57 RE-GATE-A follow-up: the original build above only moved focus IN on open; it never trapped
// Tab/Shift+Tab inside the sheet (a keyboard user could Tab straight out to the page behind it) and
// never returned focus to the Grove tap-target that opened it (focus was dropped to <body> on
// close). Both completed below, mirroring RulesOfBuildingChips.tsx's `openedFromRef`/return-focus
// pattern — captured here via `document.activeElement` at open-time (this component owns no ref to
// the Grove `<button>` itself; Grove.tsx is outside this fix's file ownership) rather than requiring
// the caller to pass one in.

'use client';

import { useEffect, useRef } from 'react';

import styles from '../today.module.css';
import { useT } from '@/app/locale-context';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export interface GroveThreeLawsSheetProps {
  open: boolean;
  onClose: () => void;
  laws: { grow: number; engage: number; wealth: number };
}

export default function GroveThreeLawsSheet({ open, onClose, laws }: GroveThreeLawsSheetProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Focus the close control the instant the sheet opens — a keyboard/SR user lands somewhere real,
  // never on whatever happened to have focus before the tap (the Grove hero button itself, which
  // would otherwise leave a screen reader announcing nothing new) — and remember that trigger so
  // focus can return to it once the sheet closes, rather than being dropped to <body>.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closeButtonRef.current?.focus();
    } else if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={styles.groveSheetBackdrop}
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
          return;
        }
        // Tab-trap: cycle Tab/Shift+Tab within the sheet's own focusable controls only — a keyboard
        // user must never be able to Tab straight out to the page behind this modal.
        if (e.key !== 'Tab') return;
        const container = panelRef.current;
        if (!container) return;
        const focusable = getFocusableElements(container);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <div
        ref={panelRef}
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
