// uiux §3 — The Grove, the ambient living-organism visualization. Three independently-driven visual
// channels (§3.1), each mapped to a Law: Branches (Grow), Leaf density/color (Engage), Fruit
// (Wealth). AC-3-1: changing one Law's inputs changes ONLY its own channel — `branchCount` derives
// from `laws.grow` alone, `leafDensity01` from `laws.engage` alone, `fruitCount` from `laws.wealth`
// alone, with no cross-term between them.
//
// Tokens only (T-05, §1) — every fill/stroke below is a CSS custom property from tokens.css via
// today.module.css classes, never a raw hex value. The dulled-leaf / stale-state visual dimming uses
// SVG `fill-opacity` (a paint property of a DECORATIVE shape), never the `opacity` CSS property or a
// translucent `color:` — those are what `guard-no-opacity-on-text.mjs` exists to catch on TEXT, and
// the Grove's caption text (rendered separately below, never inside the aria-hidden SVG) always
// stays at full, AA-token contrast. This is a deliberate, documented choice, not a guard workaround:
// dimming a decorative shape's paint alpha is the correct primitive here; dimming rendered text never
// is anywhere in this codebase.
//
// §3.3: the SVG is `aria-hidden` decorative; `caption` is rendered as an adjacent, visually-rendered
// element a screen reader announces normally — never inside the SVG, never `sr-only`.

import styles from '../today.module.css';
import type { GroveState } from '@/services/mission-control/types';

export interface GroveProps {
  state: GroveState;
  laws: { grow: number; engage: number; wealth: number };
  caption: string;
  size?: 'hero' | 'compact';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const DULL_STATES: GroveState[] = ['quiet', 'resting', 'stale'];

export default function Grove({ state, laws, caption, size = 'hero' }: GroveProps) {
  const isSeed = state === 'seed';
  const isSprout = state === 'sprout';
  const isBloom = state === 'bloom';
  const dulled = DULL_STATES.includes(state);

  // AC-3-1: each channel derives from exactly one Law's score, independently of the other two.
  const branchCount = isSeed || isSprout ? 0 : clamp(Math.round(laws.grow / 20), 0, 5);
  const leafDensity01 = isSeed ? 0 : isSprout ? 0.3 : clamp(laws.engage, 0, 100) / 100;
  const fruitCount = isSeed || isSprout ? 0 : clamp(Math.round(laws.wealth / 25), 0, 4);

  const leafFillOpacity = dulled ? Math.max(0.35, leafDensity01 * 0.6) : Math.max(0.4, leafDensity01);
  const leafClass = dulled ? styles.groveLeafDull : styles.groveLeafActive;

  const canopyCx = 100;
  const canopyCy = 55;
  const leafPositions = Array.from({ length: Math.max(branchCount, isSprout ? 2 : 0) }, (_, i) => {
    const angle = (Math.PI / (Math.max(branchCount, 2) + 1)) * (i + 1) - Math.PI / 2;
    const radius = 34;
    return { x: canopyCx + Math.cos(angle) * radius, y: canopyCy + Math.sin(angle) * radius * 0.7 };
  });

  const fruitPositions = Array.from({ length: fruitCount }, (_, i) => {
    const angle = (Math.PI / (fruitCount + 1)) * (i + 1) - Math.PI / 2;
    const radius = 22;
    return { x: canopyCx + Math.cos(angle) * radius, y: canopyCy + Math.sin(angle) * radius * 0.7 + 6 };
  });

  return (
    <div className={size === 'hero' ? styles.groveHero : styles.groveCompact} data-grove-state={state}>
      <svg
        viewBox="0 0 200 140"
        aria-hidden="true"
        className={`${styles.groveSvg} ${state !== 'stale' && !dulled ? styles.groveSway : ''}`}
      >
        {/* ground line — grass length reflects streak length (uiux §3.1); flat baseline here */}
        <ellipse cx="100" cy="122" rx="70" ry="8" className={styles.groveGround} />

        {/* soil mound */}
        <ellipse cx="100" cy="112" rx="30" ry="10" className={styles.groveMound} />

        {isSeed && <circle cx="100" cy="104" r="6" className={styles.groveSeed} />}

        {(isSprout || branchCount > 0) && (
          <line x1="100" y1="112" x2="100" y2={canopyCy + 15} className={styles.groveTrunk} strokeWidth="4" />
        )}

        {isSprout && (
          <>
            <ellipse cx="88" cy="96" rx="10" ry="6" className={leafClass} fillOpacity={0.9} />
            <ellipse cx="112" cy="96" rx="10" ry="6" className={leafClass} fillOpacity={0.9} />
          </>
        )}

        {leafPositions.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={14} className={leafClass} fillOpacity={leafFillOpacity} />
        ))}

        {fruitPositions.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={4} className={styles.groveFruit} />
        ))}

        {isBloom && <circle cx={canopyCx} cy={canopyCy} r={40} className={styles.groveBloomBurst} />}

        {dulled && <ellipse cx="100" cy="90" rx="60" ry="30" className={styles.groveMist} fillOpacity={0.25} />}
      </svg>
      <p className={styles.groveCaption}>{caption}</p>
    </div>
  );
}
