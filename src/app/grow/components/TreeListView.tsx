// WP08 uiux §5.5/AC-5.5-8 — the list-view a11y surface: "a nested list/table of the same data
// (name, level, health label, RoB status), fully screen-reader navigable and keyboard traversable
// ... ghost positions render as 'open position, level N' rows." A native `<table>` is inherently
// keyboard/screen-reader operable with zero extra JS — the deliberate choice here over a custom
// canvas-driven widget.

import type { GhostSeedling, HealthTint, OrgTreeNode } from '@/types/taprooting';
import styles from '../grow.module.css';

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

function healthLabel(tint: HealthTint, stagnant: boolean): string {
  const base = tint === 'green' ? 'Active / growth' : tint === 'yellow' ? 'Stagnant / retention risk' : 'Needs attention (reverse-maxxing)';
  return stagnant ? `${base} — no advance in 30+ days` : base;
}

function flatten(nodes: OrgTreeNode[]): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (n: OrgTreeNode) => {
    rows.push({
      kind: 'real',
      id: n.id,
      displayName: n.displayName,
      level: n.level,
      rank: n.rank,
      healthLabel: healthLabel(n.health.tint, n.health.stagnant),
      robLabel: n.hasOwnRecruit ? 'Has their own recruit' : 'No recruit yet',
    });
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return rows;
}

export default function TreeListView({ branch, nodes, ghosts }: TreeListViewProps) {
  const rows = flatten(nodes);

  return (
    <table className={styles.listTable} aria-label={branch === 'primerica' ? 'Orchard structure list' : 'Network rings list'}>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Level</th>
          <th scope="col">Rank</th>
          <th scope="col">Health</th>
          <th scope="col">Rules of Building</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={5}>No members yet — invite your first to start growing the field.</td>
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
              <td colSpan={5}>{`Open position, level ${g.level}`}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
