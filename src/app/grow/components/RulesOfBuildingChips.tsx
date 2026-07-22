// WP08 §13.2, uiux §4.8 — the Rules-of-Building chip row. Live ✓ / countdown / not-started chips
// computed from real data (never slogans); tapping a chip opens the depth-scoped override-math
// sheet, always FTC-safe-harbor-framed (master spec §13.2, uiux §4.13).
//
// T-57 RG8 (i18n; server-i18n-leak) — `tree-builder.ts`'s `computeRoBChips` used to hand this
// component pre-composed ENGLISH `label`/`countLabel` prose (the four RoB axioms, including the
// doctrine-forbidden "A recruit isn't a recruit until they have a recruit") that got rendered
// verbatim regardless of the rep's locale. Now `chips.chips` carries only structural data
// (`key`/`state`/`current`/`target`) and THIS component — the sole renderer — composes the
// localized axiom + countdown text via the catalog, doctrine-clean ("teammate", never "recruit").

'use client';

import { useEffect, useRef, useState } from 'react';

import type { OverrideMathSheet, RulesOfBuildingChip, RulesOfBuildingChips as RoBChipsType } from '@/types/taprooting';
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

/** Maps a chip's `key` to its localized RoB axiom label catalog key (the famous four rules,
 *  §13.2) — doctrine-clean ("teammate", never "recruit"). */
const AXIOM_KEY: Record<RulesOfBuildingChip['key'], string> = {
  recruit_has_recruit: 'grow.rulesOfBuilding.axiom.recruitHasRecruit',
  leg_four_deep: 'grow.rulesOfBuilding.axiom.legFourDeep',
  team_four_legs: 'grow.rulesOfBuilding.axiom.teamFourLegs',
  leader_emerged: 'grow.rulesOfBuilding.axiom.leaderEmerged',
};

/** The live countdown string ("2 of 4 deep", "1 of 4 legs", "3 emerged") — same shape
 *  `tree-builder.ts`'s `computeRoBChips` used to compose in English server-side; now composed here
 *  from the real `current`/`target` numbers via the catalog, so it's genuinely localized (CLDR
 *  plural for "emerged"), not a template that happens to only ever render in English. */
function countLabelFor(chip: RulesOfBuildingChip, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (chip.key === 'leg_four_deep') {
    return t('grow.rulesOfBuilding.countLabel.ofDeep', { current: chip.current, target: chip.target });
  }
  if (chip.key === 'team_four_legs') {
    return t('grow.rulesOfBuilding.countLabel.ofLegs', { current: chip.current, target: chip.target });
  }
  if (chip.key === 'leader_emerged' && chip.current > 0) {
    return t('grow.rulesOfBuilding.countLabel.emerged', { current: chip.current, count: chip.current });
  }
  return t('grow.rulesOfBuilding.countLabel.of', { current: chip.current, target: chip.target });
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
        {chips.chips.map((chip, index) => {
          const label = t(AXIOM_KEY[chip.key]);
          const countLabel = countLabelFor(chip, t);
          return (
            <button
              key={chip.key}
              type="button"
              role="listitem"
              className={`${styles.chip} ${chip.state === 'met' ? styles.chipMet : chip.state === 'countdown' ? styles.chipCountdown : ''}`}
              onClick={(e) => handleTap(index, e.currentTarget)}
              aria-label={t('grow.rulesOfBuilding.chipAriaLabel', { label, state: t(stateLabelKey(chip.state)), count: countLabel })}
            >
              <span className={styles.chipLabel}>{label}</span>
              <span className={styles.chipStatusRow}>
                <span aria-hidden="true">{stateGlyph(chip.state)}</span>
                <span>{countLabel}</span>
              </span>
            </button>
          );
        })}
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
