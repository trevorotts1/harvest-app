// uiux §4.6 — the Plot chip row (Community home): horizontally scrollable cards ("plots") per
// segment — name, count, a tiny soil-row motif, an A-list star filter pinned first. Scroll position
// persists (owned by the caller via `scrollLeft`/`onScrollPositionChange`, the same
// lift-state-to-the-caller convention used across this codebase's other stateful components).

'use client';

import { useRef } from 'react';

import styles from '../community.module.css';

export interface Plot {
  key: string;
  name: string;
  count: number;
}

export interface PlotsRowProps {
  plots: Plot[];
  selectedKey?: string | null;
  onSelect: (key: string | null) => void;
  /** Persisted horizontal scroll offset (px) — restored on mount, reported on scroll. */
  scrollLeft?: number;
  onScrollPositionChange?: (scrollLeft: number) => void;
}

export const A_LIST_PLOT_KEY = 'a-list';

export default function PlotsRow({ plots, selectedKey, onSelect, scrollLeft, onScrollPositionChange }: PlotsRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={(el) => {
        rowRef.current = el;
        if (el && typeof scrollLeft === 'number') el.scrollLeft = scrollLeft;
      }}
      className={styles.plotsRow}
      role="tablist"
      aria-label="Segments"
      onScroll={(e) => onScrollPositionChange?.(e.currentTarget.scrollLeft)}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selectedKey === A_LIST_PLOT_KEY}
        className={`${styles.plotChip} ${selectedKey === A_LIST_PLOT_KEY ? styles.plotChipSelected : ''}`}
        onClick={() => onSelect(selectedKey === A_LIST_PLOT_KEY ? null : A_LIST_PLOT_KEY)}
      >
        <span className={styles.plotChipName}>
          <span className={styles.plotAListStar} aria-hidden="true">
            ★
          </span>{' '}
          A-list
        </span>
      </button>

      {plots.map((plot) => (
        <button
          key={plot.key}
          type="button"
          role="tab"
          aria-selected={selectedKey === plot.key}
          className={`${styles.plotChip} ${selectedKey === plot.key ? styles.plotChipSelected : ''}`}
          onClick={() => onSelect(selectedKey === plot.key ? null : plot.key)}
        >
          <span className={styles.plotChipName}>{plot.name}</span>
          <span className={styles.plotChipCount}>{plot.count}</span>
          <span className={styles.plotSoilRow} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
