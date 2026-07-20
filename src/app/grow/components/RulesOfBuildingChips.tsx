// WP08 §13.2, uiux §4.8 — the Rules-of-Building chip row. Live ✓ / countdown / not-started chips
// computed from real data (never slogans); tapping a chip opens the depth-scoped override-math
// sheet, always FTC-safe-harbor-framed (master spec §13.2, uiux §4.13).

'use client';

import { useState } from 'react';

import type { OverrideMathSheet, RulesOfBuildingChips as RoBChipsType } from '@/types/taprooting';
import styles from '../grow.module.css';

export interface RulesOfBuildingChipsProps {
  chips: RoBChipsType;
  onOpenMath: (depth: number) => Promise<OverrideMathSheet>;
}

function stateGlyph(state: 'met' | 'countdown' | 'not_started'): string {
  if (state === 'met') return '✓';
  if (state === 'countdown') return '…';
  return '·';
}

function stateLabel(state: 'met' | 'countdown' | 'not_started'): string {
  if (state === 'met') return 'met';
  if (state === 'countdown') return 'in progress';
  return 'not started';
}

export default function RulesOfBuildingChips({ chips, onOpenMath }: RulesOfBuildingChipsProps) {
  const [sheet, setSheet] = useState<OverrideMathSheet | null>(null);
  const [loadingDepth, setLoadingDepth] = useState<number | null>(null);

  const handleTap = async (index: number) => {
    const depth = index + 1; // chip order maps 1:1 to a representative depth (1..4) for the math sheet.
    setLoadingDepth(depth);
    try {
      const result = await onOpenMath(depth);
      setSheet(result);
    } finally {
      setLoadingDepth(null);
    }
  };

  return (
    <div>
      <div className={styles.chipRow} role="list" aria-label="Rules of Building">
        {chips.chips.map((chip, index) => (
          <button
            key={chip.key}
            type="button"
            role="listitem"
            className={`${styles.chip} ${chip.state === 'met' ? styles.chipMet : chip.state === 'countdown' ? styles.chipCountdown : ''}`}
            onClick={() => handleTap(index)}
            aria-label={`${chip.label}: ${stateLabel(chip.state)}, ${chip.countLabel}`}
          >
            <span className={styles.chipLabel}>{chip.label}</span>
            <span className={styles.chipStatusRow}>
              <span aria-hidden="true">{stateGlyph(chip.state)}</span>
              <span>{chip.countLabel}</span>
            </span>
          </button>
        ))}
      </div>

      {loadingDepth !== null && <p role="status">Loading the depth-{loadingDepth} math…</p>}

      {sheet && (
        <div className={styles.card} role="dialog" aria-label={`Override math for depth ${sheet.depth}`}>
          <p>{sheet.narrative}</p>
          <p className={styles.badge}>Potential — not a promise</p>
          <p>{sheet.safeHarborDisclaimer}</p>
          <button type="button" className={styles.iconButton} onClick={() => setSheet(null)} aria-label="Close">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
