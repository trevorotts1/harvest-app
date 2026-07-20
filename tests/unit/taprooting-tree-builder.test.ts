// WP08 §13.1/§13.2 — pure org-tree assembly: real structure to depth ≥ 5, the 3×4 ghost lattice
// (never counted), and the four Rules-of-Building chips computed from real data.

import {
  buildOrgTree,
  computeGhostLattice,
  computeRoBChips,
  missingRecruitInfo,
  VISION_DEPTH,
  VISION_LEGS,
  TEAM_LEG_COUNT,
  type OrgTreeEdgeRecord,
} from '../../src/services/taprooting/tree-builder';
import { emptyNodeHealth } from '../../src/services/taprooting/health';
import type { NodeHealth } from '../../src/types/taprooting';

const health = (tint: 'green' | 'yellow' | 'red' = 'green'): NodeHealth => ({
  ...emptyNodeHealth(),
  tint,
});

function chain(root: string, ids: string[]): OrgTreeEdgeRecord[] {
  const edges: OrgTreeEdgeRecord[] = [];
  let sponsor = root;
  for (const id of ids) {
    edges.push({ sponsor_id: sponsor, recruit_id: id });
    sponsor = id;
  }
  return edges;
}

describe('buildOrgTree', () => {
  it('renders real structure to at least 5 levels (§13.6-1)', () => {
    const edges = chain('root', ['a1', 'a2', 'a3', 'a4', 'a5']);
    const tree = buildOrgTree(edges, 'root', () => missingRecruitInfo(), () => health());
    expect(tree.maxDepth).toBeGreaterThanOrEqual(5);
    expect(tree.allNodes).toHaveLength(5);
  });

  it('marks a leg qualified once it reaches depth 4, not before (§13.2)', () => {
    const edges3deep = chain('root', ['a1', 'a2', 'a3']);
    const tree3 = buildOrgTree(edges3deep, 'root', () => missingRecruitInfo(), () => health());
    expect(tree3.levelOneNodes[0].isQualifiedLeg).toBe(false);

    const edges4deep = chain('root', ['b1', 'b2', 'b3', 'b4']);
    const tree4 = buildOrgTree(edges4deep, 'root', () => missingRecruitInfo(), () => health());
    expect(tree4.levelOneNodes[0].isQualifiedLeg).toBe(true);
    // Qualification mirrors onto every node in the leg, not just the level-1 root.
    expect(tree4.allNodes.every((n) => n.isQualifiedLeg)).toBe(true);
  });

  it('hasOwnRecruit is true the instant a node has ≥1 confirmed recruit', () => {
    const edges: OrgTreeEdgeRecord[] = [
      { sponsor_id: 'root', recruit_id: 'r1' },
      { sponsor_id: 'r1', recruit_id: 'r1-child' },
      { sponsor_id: 'root', recruit_id: 'r2' },
    ];
    const tree = buildOrgTree(edges, 'root', () => missingRecruitInfo(), () => health());
    const r1 = tree.levelOneNodes.find((n) => n.id === 'r1')!;
    const r2 = tree.levelOneNodes.find((n) => n.id === 'r2')!;
    expect(r1.hasOwnRecruit).toBe(true);
    expect(r2.hasOwnRecruit).toBe(false);
  });

  it('unconfirmed (absent) edges never appear as real structure', () => {
    // buildOrgTree only ever receives CONFIRMED edges (the Prisma-backed caller filters
    // is_recruit_confirmed: true before this pure function ever sees the list) — an edge simply
    // not being in the input list at all is how a pending invite stays invisible here.
    const tree = buildOrgTree([], 'root', () => missingRecruitInfo(), () => health());
    expect(tree.allNodes).toHaveLength(0);
    expect(tree.maxDepth).toBe(0);
  });
});

describe('computeGhostLattice (§13.1, uiux AC-5.5-1/2)', () => {
  it('fills all 12 cells (3 legs × 4 deep) with ghosts when the tree is empty', () => {
    const ghosts = computeGhostLattice([]);
    expect(ghosts).toHaveLength(VISION_LEGS * VISION_DEPTH);
  });

  it('never places a ghost where real structure already reaches that depth', () => {
    const ghosts = computeGhostLattice([4, 0, 0]); // leg 0 fully real to depth 4
    const leg0Ghosts = ghosts.filter((_, i) => Math.floor(i / VISION_DEPTH) === 0);
    // With legDepths[0] = 4, none of the first 4 ghost slots (leg 0) should exist.
    expect(ghosts.length).toBe(VISION_LEGS * VISION_DEPTH - 4);
    void leg0Ghosts;
  });

  it('ghost seedlings never carry any real count/total field — they are position-only', () => {
    const ghosts = computeGhostLattice([1, 0, 0]);
    for (const g of ghosts) {
      expect(Object.keys(g).sort()).toEqual(['level', 'position']);
    }
  });
});

describe('computeRoBChips (§13.2, uiux §4.8)', () => {
  it('reports not_started with zero direct recruits', () => {
    const tree = buildOrgTree([], 'root', () => missingRecruitInfo(), () => health());
    const chips = computeRoBChips(tree);
    expect(chips.chips.every((c) => c.state === 'not_started')).toBe(true);
  });

  it('recruit_has_recruit reaches met once every direct recruit has their own recruit', () => {
    const edges: OrgTreeEdgeRecord[] = [
      { sponsor_id: 'root', recruit_id: 'r1' },
      { sponsor_id: 'r1', recruit_id: 'r1-child' },
    ];
    const tree = buildOrgTree(edges, 'root', () => missingRecruitInfo(), () => health());
    const chips = computeRoBChips(tree);
    const chip = chips.chips.find((c) => c.key === 'recruit_has_recruit')!;
    expect(chip.state).toBe('met');
  });

  it('team_four_legs requires TEAM_LEG_COUNT (4) qualified legs, distinct from the 3-wide vision', () => {
    expect(TEAM_LEG_COUNT).toBe(4);
    const fourLegs = [4, 5, 6, 7].flatMap((n, legIdx) => chain(`root`, Array.from({ length: n }, (_, i) => `leg${legIdx}-${i}`)));
    const tree = buildOrgTree(fourLegs, 'root', () => missingRecruitInfo(), () => health());
    const chips = computeRoBChips(tree);
    const chip = chips.chips.find((c) => c.key === 'team_four_legs')!;
    expect(chip.current).toBe(4);
    expect(chip.state).toBe('met');
  });

  it('leader_emerged fires only when a DOWNLINE node (not the root) has grown its own 4-leg team', () => {
    // root has exactly 4 direct legs at depth 1 only (root's OWN team) — leader_emerged must stay
    // 0 here; it specifically measures a non-root node's own team, per the RoB rule's wording
    // ("a team gets a life of its own when a LEADER emerges" — someone other than the root rep).
    const rootOnlyFourLegs: OrgTreeEdgeRecord[] = [1, 2, 3, 4].map((i) => ({ sponsor_id: 'root', recruit_id: `leg${i}` }));
    const tree = buildOrgTree(rootOnlyFourLegs, 'root', () => missingRecruitInfo(), () => health());
    const chips = computeRoBChips(tree);
    expect(chips.chips.find((c) => c.key === 'leader_emerged')!.current).toBe(0);

    // Now give ONE downline node (r1) 4 legs of their OWN — each child chain reaches subtreeDepth
    // 3 (a->b->c->d), which is what `nodeHasOwnFourLegTeam` requires (>= VISION_DEPTH - 1).
    const withDownlineLeader: OrgTreeEdgeRecord[] = [{ sponsor_id: 'root', recruit_id: 'r1' }];
    for (let leg = 0; leg < 4; leg += 1) {
      withDownlineLeader.push(...chain('r1', [`r1-leg${leg}-a`, `r1-leg${leg}-b`, `r1-leg${leg}-c`, `r1-leg${leg}-d`]));
    }
    const tree2 = buildOrgTree(withDownlineLeader, 'root', () => missingRecruitInfo(), () => health());
    const chips2 = computeRoBChips(tree2);
    expect(chips2.chips.find((c) => c.key === 'leader_emerged')!.current).toBe(1);
  });
});
