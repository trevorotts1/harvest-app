// T-57 R1c (parity defect MAJOR-C4) — `TreeListView` (src/app/grow/components/TreeListView.tsx)
// renders a bare `<table>` with no min-width/overflow handling of its own. On a narrow viewport
// that used to force page-level horizontal scroll. The fix wraps the table in a `.listTableWrap`
// scroll container (grow.module.css) mirroring the existing `.previewTableWrap` pattern
// (community.module.css:351-355). TreeListView takes its data as props (no internal fetch/effect),
// so — unlike the fetch-driven pages in this app — its fully-populated "ready" render IS reachable
// in this repo's no-jsdom, single-pass `renderToStaticMarkup` Jest environment.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TreeListView from '@/app/grow/components/TreeListView';
import type { GhostSeedling, OrgTreeNode } from '@/types/taprooting';

const node = (id: string, displayName: string): OrgTreeNode => ({
  id,
  displayName,
  rank: 'Agent',
  level: 1,
  ownActivitySize: 2,
  health: { tint: 'green', score: 80, laws: { grow: 1, engage: 1, wealth: 1 }, stagnant: false, daysSinceLastActivity: 1 },
  hasOwnRecruit: false,
  ownDepthReached: 0,
  isQualifiedLeg: false,
  children: [],
});

const ghost = (level: number, position: number): GhostSeedling => ({ level, position });

describe('Orchard list-view (TreeListView) — overflow container (T-57 R1c, C4)', () => {
  test('the table is wrapped in the .listTableWrap scroll container, not rendered bare', () => {
    const html = renderToStaticMarkup(
      createElement(TreeListView, { branch: 'primerica', nodes: [node('n1', 'Alex R.')], ghosts: [ghost(2, 1)] })
    );
    // styleMock.js proxies CSS-module class lookups to their bare key name, so
    // `styles.listTableWrap` / `styles.listTable` survive into the static-render HTML unchanged.
    expect(html).toMatch(/<div class="listTableWrap"><table class="listTable"/);
  });

  test('real rows and the ghost-lattice row (Primerica only) still render inside the wrapped table', () => {
    const html = renderToStaticMarkup(
      createElement(TreeListView, { branch: 'primerica', nodes: [node('n1', 'Alex R.')], ghosts: [ghost(2, 1)] })
    );
    expect(html).toContain('Alex R.');
    expect(html).toContain('class="ghostRow"');
  });

  test('the universal branch (no ghost lattice) also renders inside the wrapper', () => {
    const html = renderToStaticMarkup(
      createElement(TreeListView, { branch: 'universal', nodes: [node('n2', 'Jamie K.')], ghosts: [] })
    );
    expect(html).toMatch(/<div class="listTableWrap">/);
    expect(html).toContain('Jamie K.');
    expect(html).not.toContain('class="ghostRow"');
  });
});
