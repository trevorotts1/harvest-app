// WP08 §13.2, uiux §4.8 — the Rules-of-Building chip row. Live ✓ / countdown / not-started chips
// computed from real data (never slogans); tapping a chip opens the depth-scoped override-math
// sheet, always FTC-safe-harbor-framed (master spec §13.2, uiux §4.13).

'use client';

import { useEffect, useRef, useState } from 'react';

import type { OverrideMathSheet, RulesOfBuildingChips as RoBChipsType } from '@/types/taprooting';
import styles from '../grow.module.css';
import { useT } from '@/app/locale-context';

export interface RulesOfBuildingChipsProps {
  chips: RoBChipsType;
  onOpenMath: (depth: number) => Promise<OverrideMathSheet>;
}

function stateGlyph(state: 'met' | 'countdown' | 'not_started'): string {
  if (state === 'met') return '✓';
  if (state === 'countdown') return '…';
  return '·';
}

function stateLabelKey(state: 'met' | 'countdown' | 'not_started'): string {
  if (state === 'met') return 'grow.rulesOfBuilding.stateLabel.met';
  if (state === 'countdown') return 'grow.rulesOfBuilding.stateLabel.countdown';
  return 'grow.rulesOfBuilding.stateLabel.notStarted';
}

export default function RulesOfBuildingChips({ chips, onOpenMath }: RulesOfBuildingChipsProps) {
  const t = useT();
  const [sheet, setSheet] = useState<OverrideMathSheet | null>(null);
  const [loadingDepth, setLoadingDepth] = useState<number | null>(null);
  // T-52 (WCAG 2.2 AA §17.4 / uiux §6.1 item 2 "full keyboard and switch navigation"): the chip
  // that opened the sheet, so focus RETURNS there on close, rather than being dropped to <body>
  // (a keyboard/switch user would otherwise lose their place in the chip row entirely).
  const openedFromRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const closeSheet = () => {
    setSheet(null);
    openedFromRef.current?.focus();
  };

  const handleTap = async (index: number, triggerEl: HTMLButtonElement) => {
    const depth = index + 1; // chip order maps 1:1 to a representative depth (1..4) for the math sheet.
    openedFromRef.current = triggerEl;
    setLoadingDepth(depth);
    try {
      const result = await onOpenMath(depth);
      setSheet(result);
    } finally {
      setLoadingDepth(null);
    }
  };

  // T-52: move focus INTO the sheet the moment it opens (onto its one control, Close) — a real
  // modal must not leave keyboard focus behind on the trigger while a new layer covers the screen.
  useEffect(() => {
    if (sheet) closeButtonRef.current?.focus();
  }, [sheet]);

  return (
    <div>
      <div className={styles.chipRow} role="list" aria-label={t('grow.rulesOfBuilding.title')}>
        {chips.chips.map((chip, index) => (
          <button
            key={chip.key}
            type="button"
            role="listitem"
            className={`${styles.chip} ${chip.state === 'met' ? styles.chipMet : chip.state === 'countdown' ? styles.chipCountdown : ''}`}
            onClick={(e) => handleTap(index, e.currentTarget)}
            aria-label={t('grow.rulesOfBuilding.chipAriaLabel', { label: chip.label, state: t(stateLabelKey(chip.state)), count: chip.countLabel })}
          >
            <span className={styles.chipLabel}>{chip.label}</span>
            <span className={styles.chipStatusRow}>
              <span aria-hidden="true">{stateGlyph(chip.state)}</span>
              <span>{chip.countLabel}</span>
            </span>
          </button>
        ))}
      </div>

      {loadingDepth !== null && <p role="status">{t('grow.rulesOfBuilding.loadingDepthTemplate', { depth: loadingDepth })}</p>}

      {sheet && (
        // T-52: `aria-modal="true"` (this sheet is the only thing that should be operable while
        // open) + an `Escape` handler, matching every other native/OS dialog's keyboard contract —
        // §6.1 item 2 "full keyboard and switch navigation on every flow".
        <div
          className={styles.card}
          role="dialog"
          aria-modal="true"
          aria-label={t('grow.rulesOfBuilding.overrideMathAriaLabel', { depth: sheet.depth })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeSheet();
          }}
        >
          <p>{sheet.narrative}</p>
          <p className={styles.badge}>{t('grow.rulesOfBuilding.potentialNotPromise')}</p>
          <p>{sheet.safeHarborDisclaimer}</p>
          <button type="button" ref={closeButtonRef} className={styles.iconButton} onClick={closeSheet} aria-label={t('grow.rulesOfBuilding.closeCta')}>
            {t('grow.rulesOfBuilding.closeCta')}
          </button>
        </div>
      )}
    </div>
  );
}
