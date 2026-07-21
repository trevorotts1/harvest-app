// WP08 uiux §5.5/AC-5.5-8 — the list-view a11y surface: "a nested list/table of the same data
// (name, level, health label, RoB status), fully screen-reader navigable and keyboard traversable
// ... ghost positions render as 'open position, level N' rows." A native `<table>` is inherently
// keyboard/screen-reader operable with zero extra JS — the deliberate choice here over a custom
// canvas-driven widget.

import type { GhostSeedling, HealthTint, OrgTreeNode } from '@/types/taprooting';
import styles from '../grow.module.css';
import { useT } from '@/app/locale-context';
import type { TVars } from '@/lib/i18n/catalog';

export interface TreeListViewProps {
  branch: 'primerica' | 'universal';
  nodes: OrgTreeNode[];
  ghosts: GhostSeedling[];
}

interface FlatRow {
  kind: 'real' | 'ghost';
  id: string;
  displayName: string;
  level: number;
  rank: string | null;
  healthLabel: string;
  robLabel: string;
}

function healthLabel(tint: HealthTint, stagnant: boolean, t: (key: string, vars?: TVars) => string): string {
  const baseKey =
    tint === 'green'
      ? 'grow.treeList.healthLabel.green'
      : tint === 'yellow'
        ? 'grow.treeList.healthLabel.yellow'
        : 'grow.treeList.healthLabel.red';
  const base = t(baseKey);
  return stagnant ? `${base}${t('grow.treeList.stagnantSuffix')}` : base;
}

function flatten(nodes: OrgTreeNode[], t: (key: string, vars?: TVars) => string): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (n: OrgTreeNode) => {
    rows.push({
      kind: 'real',
      id: n.id,
      displayName: n.displayName,
      level: n.level,
      rank: n.rank,
      healthLabel: healthLabel(n.health.tint, n.health.stagnant, t),
      robLabel: t(n.hasOwnRecruit ? 'grow.treeList.robHasRecruit' : 'grow.treeList.robNoRecruit'),
    });
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return rows;
}

export default function TreeListView({ branch, nodes, ghosts }: TreeListViewProps) {
  const t = useT();
  const rows = flatten(nodes, t);

  return (
    // T-57 R1c (C4) — `.listTable` has no min-width/overflow handling of its own; below the 860px
    // nav breakpoint (or any narrow viewport) 5 columns of real content can force page-level
    // horizontal scroll. `.listTableWrap` contains that scroll to this card instead, mirroring the
    // overflow-x:auto pattern at community.module.css:351-355 (`.previewTableWrap`).
    <div className={styles.listTableWrap}>
      <table className={styles.listTable} aria-label={t(branch === 'primerica' ? 'grow.treeList.ariaLabelPrimerica' : 'grow.treeList.ariaLabelUniversal')}>
        <thead>
          <tr>
            <th scope="col">{t('grow.treeList.nameHeader')}</th>
            <th scope="col">{t('grow.treeList.levelHeader')}</th>
            <th scope="col">{t('grow.treeList.rankHeader')}</th>
            <th scope="col">{t('grow.treeList.healthHeader')}</th>
            <th scope="col">{t('grow.rulesOfBuilding.title')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5}>{t('grow.treeList.emptyState')}</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.displayName}</td>
              <td>{r.level}</td>
              <td>{r.rank ?? '—'}</td>
              <td>{r.healthLabel}</td>
              <td>{r.robLabel}</td>
            </tr>
          ))}
          {branch === 'primerica' &&
            ghosts.map((g) => (
              <tr key={`ghost-${g.position}`} className={styles.ghostRow}>
                <td colSpan={5}>{t('grow.openPositionTemplate', { level: g.level })}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
