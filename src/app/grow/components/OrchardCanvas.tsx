// WP08 §13.1, uiux §5.5 — the pannable orchard/rings canvas. `role="img"` + a text summary (the
// canvas is DECORATIVE per uiux §5.5 "the canvas itself is role='img' with a summary label" — the
// list view, not this component, is the a11y surface, AC-5.5-8). Real nodes are laid out tiered by
// generation (an honest, legible simplification of the true tree geometry — precise parent-child
// branching is what the list view/table renders exactly; this canvas trades geometric precision
// for a calm, always-legible "reality + vision" glance, uiux §5.5's own "always both" framing).
//
// Health tint (§13.1): green = fill (active/growth), yellow = fill (stagnant/retention-risk), RED
// renders as a CLAY OUTLINE ONLY + a `flag-caution` glyph + "needs attention" label next to the
// node — never a clay FILL (uiux AC-5.5-4, "clay fill stays compliance-reserved"). Status is never
// color-alone (§6.1): every tint also carries the glyph + text.
//
// Ghost seedlings (§13.1, uiux §4.8): dashed silhouettes at 38% opacity — set as an SVG
// `fillOpacity`/`strokeOpacity` PROP on the shape (never a CSS `opacity` declaration), the same
// convention `Grove.tsx` already established for decorative dimming.

import styles from '../grow.module.css';
import type { GhostSeedling, HealthTint, OrgTreeNode } from '@/types/taprooting';
import { useT } from '@/app/locale-context';
import type { TVars } from '@/lib/i18n/catalog';

export interface OrchardCanvasProps {
  branch: 'primerica' | 'universal';
  nodes: OrgTreeNode[];
  ghosts: GhostSeedling[];
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

const NODE_R = 22;
const COL_GAP = 70;
const ROW_GAP = 80;
const GHOST_R = 16;

function flattenByLevel(nodes: OrgTreeNode[]): Map<number, OrgTreeNode[]> {
  const byLevel = new Map<number, OrgTreeNode[]>();
  const walk = (n: OrgTreeNode) => {
    const list = byLevel.get(n.level) ?? [];
    list.push(n);
    byLevel.set(n.level, list);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return byLevel;
}

function tintClass(tint: HealthTint): string {
  if (tint === 'green') return styles.nodeGreen;
  if (tint === 'yellow') return styles.nodeYellow;
  return styles.nodeRed;
}

function tintLabelKey(tint: HealthTint): string {
  if (tint === 'green') return 'grow.orchardCanvas.tintLabel.green';
  if (tint === 'yellow') return 'grow.orchardCanvas.tintLabel.yellow';
  return 'grow.orchardCanvas.tintLabel.red';
}

function buildSummary(
  branch: 'primerica' | 'universal',
  nodes: OrgTreeNode[],
  ghosts: GhostSeedling[],
  t: (key: string, vars?: TVars) => string
): string {
  const count = (function countAll(list: OrgTreeNode[]): number {
    return list.reduce((sum, n) => sum + 1 + countAll(n.children), 0);
  })(nodes);
  const base = t(branch === 'primerica' ? 'grow.orchardCanvas.summaryBasePrimerica' : 'grow.orchardCanvas.summaryBaseUniversal');
  const members = t('grow.orchardCanvas.summaryMembers', { count });
  const ghostPart =
    branch === 'primerica'
      ? t('grow.orchardCanvas.summaryGhosts', { count: ghosts.length })
      : '';
  return `${base}: ${members}${ghostPart}.`;
}

export default function OrchardCanvas({ branch, nodes, ghosts, zoom, onZoomIn, onZoomOut }: OrchardCanvasProps) {
  const t = useT();
  const byLevel = flattenByLevel(nodes);
  const maxLevel = Math.max(0, ...Array.from(byLevel.keys()));
  const maxGhostLevel = ghosts.length > 0 ? Math.max(...ghosts.map((g) => g.level)) : 0;
  const height = (Math.max(maxLevel, maxGhostLevel) + 1) * ROW_GAP + 60;

  const realWidthLevels = Array.from(byLevel.entries()).map(([, list]) => list.length);
  const ghostWidth = branch === 'primerica' ? 3 : 0;
  const width = Math.max(6, ...realWidthLevels, ghostWidth) * COL_GAP + 80;

  return (
    <div>
      <div className={styles.toolbar} style={{ marginBottom: 8 }}>
        <button type="button" className={styles.iconButton} onClick={onZoomOut} aria-label={t('grow.orchardCanvas.zoomOutAria')}>
          -
        </button>
        <span aria-hidden="true">{Math.round(zoom * 100)}%</span>
        <button type="button" className={styles.iconButton} onClick={onZoomIn} aria-label={t('grow.orchardCanvas.zoomInAria')}>
          +
        </button>
      </div>
      <div className={styles.canvasWrap}>
        <svg
          className={styles.canvasSvg}
          role="img"
          aria-label={buildSummary(branch, nodes, ghosts, t)}
          width={width * zoom}
          height={height * zoom}
          viewBox={`0 0 ${width} ${height}`}
        >
          {/* Root — the tree owner, soil line at the bottom (§13.1 "the rep at the root"). */}
          <line x1={0} y1={height - 20} x2={width} y2={height - 20} stroke="var(--line)" strokeWidth={1} />
          <circle cx={width / 2} cy={height - 20} r={NODE_R} className={styles.nodeGreen} />
          <text x={width / 2} y={height - 20} textAnchor="middle" dominantBaseline="middle" className={styles.nodeLabel}>
            {t('grow.orchardCanvas.youLabel')}
          </text>

          {/* Real nodes, tiered by generation (see module doc — a legible simplification; the list
              view is the exact, geometrically-faithful surface). */}
          {Array.from(byLevel.entries()).map(([level, list]) =>
            list.map((node, i) => {
              const x = ((i + 1) / (list.length + 1)) * width;
              const y = height - 20 - level * ROW_GAP;
              return (
                <g key={node.id}>
                  <circle cx={x} cy={y} r={NODE_R} className={tintClass(node.health.tint)} strokeWidth={node.health.tint === 'red' ? 2.5 : 1} />
                  <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" className={styles.nodeLabel}>
                    {node.displayName}
                  </text>
                  {node.health.tint === 'red' && (
                    <text x={x} y={y + NODE_R + 14} textAnchor="middle" className={styles.nodeLabel} aria-hidden="true">
                      {t('grow.orchardCanvas.needsAttentionLabel')}
                    </text>
                  )}
                  <title>{t('grow.orchardCanvas.nodeTitleTemplate', { name: node.displayName, level: node.level, tint: t(tintLabelKey(node.health.tint)) })}</title>
                </g>
              );
            })
          )}

          {/* Ghost seedlings (Primerica-only) — 3-wide × 4-deep vision, never counted (§13.1). */}
          {branch === 'primerica' &&
            ghosts.map((g) => {
              const legIndex = (g.position - 1) % 3;
              const x = ((legIndex + 1) / 4) * width;
              const y = height - 20 - g.level * ROW_GAP;
              return (
                <g key={`ghost-${g.position}`}>
                  <circle
                    cx={x}
                    cy={y}
                    r={GHOST_R}
                    className={styles.ghostSeedling}
                    fillOpacity={0.38}
                    strokeOpacity={0.38}
                  />
                  <title>{t('grow.openPositionTemplate', { level: g.level })}</title>
                </g>
              );
            })}
        </svg>
      </div>
    </div>
  );
}
