// WP08 §13.1/§13.2 — pure org-tree assembly: real structure from `OrgTreeEdge`, the 3×4 ghost
// lattice, and the four Rules-of-Building chips. Zero I/O (no Prisma import) so this is unit-
// testable with a plain in-memory edge list, mirroring the codebase's DI convention
// (mission-control/testing/in-memory-db.ts, eligibility.ts's narrow interfaces).
//
// `leg_depth` / `is_leg` / `has_own_recruit` / `health_index` are the WP08-owned `OrgTreeEdge`
// columns the schema itself documents as "maintained by the application layer, not generated
// columns" — this module IS that application layer. Definitions (load-bearing, read before
// editing):
//   - `level` — generation distance from the tree owner: a direct recruit is level 1, their
//     recruit is level 2, etc.
//   - a "leg" is the whole lineage rooted at ONE level-1 direct recruit (§13.2 "a leg is not a leg
//     until it is four deep").
//   - `legDepth` (computed per leg, at its level-1 root) — the deepest generation reached ANYWHERE
//     in that leg's subtree (0 = the direct recruit has no recruits of their own yet).
//   - `isQualifiedLeg` — `legDepth >= 4`, mirrored onto every node within that leg (a per-edge
//     column, so every edge in a qualified leg reads `is_leg = true`, not only its level-1 root).
//   - `hasOwnRecruit` — true the moment a node has ≥ 1 confirmed recruit of their own (RoB rule 1).

import type {
  GhostSeedling,
  NodeHealth,
  OrgTreeNode,
  RoBChipState,
  RulesOfBuildingChip,
  RulesOfBuildingChips,
} from '@/types/taprooting';
import { emptyNodeHealth } from './health';

/** The narrow `OrgTreeEdge` read shape this module needs — satisfied directly by a Prisma row, or
 *  a plain object in tests. Only CONFIRMED edges (`is_recruit_confirmed`) count as real structure
 *  (§6.6): a pending invite is not yet a recruit, and must not occupy a ghost's slot either way —
 *  it simply is not in this list at all until confirmed. */
export interface OrgTreeEdgeRecord {
  sponsor_id: string;
  recruit_id: string;
}

export interface RecruitInfo {
  displayName: string;
  rank: string | null;
  ownActivitySize: number;
}

/** The 3-wide × 4-deep vision lattice (§13.1). Exported so callers/tests never hand-roll a magic
 *  number that could drift from the ghost-lattice logic below. */
export const VISION_LEGS = 3;
export const VISION_DEPTH = 4;
/** §13.2 "a team is not a team until it has four legs" — a DISTINCT constant from `VISION_LEGS`
 *  (the 3-wide base ghost lattice): the team-chip target is 4 real qualified legs, one more than
 *  the 3 the base vision lattice ghosts in, since a 4th leg is genuine growth beyond that base
 *  vision, not a re-use of the same number by coincidence. */
export const TEAM_LEG_COUNT = 4;

function subtreeDepth(node: OrgTreeNode): number {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(subtreeDepth));
}

/** Builds one node (and its subtree) recursively from the confirmed-edge adjacency list. */
function buildNode(
  recruitId: string,
  level: number,
  edgesBySponsor: Map<string, string[]>,
  recruitInfo: (id: string) => RecruitInfo,
  healthFor: (id: string) => NodeHealth
): OrgTreeNode {
  const childIds = edgesBySponsor.get(recruitId) ?? [];
  const info = recruitInfo(recruitId);
  const children = childIds.map((childId) => buildNode(childId, level + 1, edgesBySponsor, recruitInfo, healthFor));
  const ownDepthReached = children.length === 0 ? 0 : 1 + Math.max(...children.map((c) => c.ownDepthReached));

  return {
    id: recruitId,
    displayName: info.displayName,
    rank: info.rank,
    level,
    ownActivitySize: info.ownActivitySize,
    health: healthFor(recruitId),
    hasOwnRecruit: children.length > 0,
    ownDepthReached,
    // Filled in by `markLegQualification` once the whole tree is built (a leg's qualification is a
    // property of its level-1 root, mirrored onto descendants — see module doc above).
    isQualifiedLeg: false,
    children,
  };
}

/** Second pass: mirrors each level-1 leg's `legDepth >= 4` qualification onto every node inside it. */
function markLegQualification(levelOneNodes: OrgTreeNode[]): void {
  const mark = (node: OrgTreeNode, qualified: boolean) => {
    node.isQualifiedLeg = qualified;
    node.children.forEach((c) => mark(c, qualified));
  };
  for (const leg of levelOneNodes) {
    // legDepth counted from the DIRECT RECRUIT as generation 1 (uiux §4.8 "2 of 4 deep" reads as
    // the direct recruit already being depth 1) — so `1 + ownDepthReached` reaches 4 exactly when
    // the leg has a confirmed member at the 4th generation.
    const legDepth = 1 + leg.ownDepthReached;
    mark(leg, legDepth >= VISION_DEPTH);
  }
}

export interface BuiltOrgTree {
  levelOneNodes: OrgTreeNode[];
  /** Every node in the tree, flattened, root excluded — for totals/list-view/health sweeps. */
  allNodes: OrgTreeNode[];
  maxDepth: number;
  /** Per-leg depth (1 + ownDepthReached), in level-1 join order — feeds the ghost lattice. */
  legDepths: number[];
}

/**
 * Builds the real structure reachable from `rootId` via confirmed `OrgTreeEdge` rows. Depth is
 * unbounded here (callers may cap rendering depth; §13.1 requires visibility to "10+ levels", so
 * this module itself never truncates).
 */
export function buildOrgTree(
  edges: OrgTreeEdgeRecord[],
  rootId: string,
  recruitInfo: (id: string) => RecruitInfo,
  healthFor: (id: string) => NodeHealth
): BuiltOrgTree {
  const edgesBySponsor = new Map<string, string[]>();
  for (const e of edges) {
    const list = edgesBySponsor.get(e.sponsor_id) ?? [];
    list.push(e.recruit_id);
    edgesBySponsor.set(e.sponsor_id, list);
  }

  const directRecruitIds = edgesBySponsor.get(rootId) ?? [];
  const levelOneNodes = directRecruitIds.map((id) => buildNode(id, 1, edgesBySponsor, recruitInfo, healthFor));
  markLegQualification(levelOneNodes);

  const allNodes: OrgTreeNode[] = [];
  const collect = (node: OrgTreeNode) => {
    allNodes.push(node);
    node.children.forEach(collect);
  };
  levelOneNodes.forEach(collect);

  const maxDepth = levelOneNodes.length === 0 ? 0 : Math.max(...levelOneNodes.map(subtreeDepth)) + 1;
  const legDepths = levelOneNodes.map((leg) => 1 + leg.ownDepthReached);

  return { levelOneNodes, allNodes, maxDepth, legDepths };
}

/** A recruit-info/health lookup with an honest zero default — never fabricates a name/score for an
 *  id the caller didn't supply data for. */
export function missingRecruitInfo(): RecruitInfo {
  return { displayName: 'Unknown', rank: null, ownActivitySize: 0 };
}
export const missingHealth = emptyNodeHealth;

// ─── Ghost lattice (§13.1, uiux §4.8, AC-5.5-1/2) ─────────────────────────────────────────────────

/**
 * The 3×4 vision lattice, Primerica-only (§13.1 — the universal ring view has "no lattice" by
 * construction, uiux §5.5). Column `i` (0-based, i < VISION_LEGS) is entirely ghost if the tree
 * owner has fewer than `i+1` real direct recruits; otherwise it is ghost for every generation past
 * `legDepths[i]` up to `VISION_DEPTH`. Real growth beyond the base 3 legs or beyond depth 4 is
 * still real (rendered as ordinary tree nodes) — it simply has no corresponding ghost cell, since
 * the lattice only models the BASE vision, not a ceiling on real growth. Ghosts NEVER count in any
 * total/chip/math (uiux AC-5.5-2) — this function's return value is only ever rendered, never
 * summed into `totals`.
 */
export function computeGhostLattice(legDepths: number[]): GhostSeedling[] {
  const ghosts: GhostSeedling[] = [];
  let position = 0;
  for (let leg = 0; leg < VISION_LEGS; leg += 1) {
    const depthReached = leg < legDepths.length ? legDepths[leg] : 0;
    for (let level = 1; level <= VISION_DEPTH; level += 1) {
      if (level > depthReached) {
        position += 1;
        ghosts.push({ level, position });
      }
    }
  }
  return ghosts;
}

// ─── Rules of Building chips (§13.2, uiux §4.8) ───────────────────────────────────────────────────

function chipState(current: number, target: number): RoBChipState {
  if (current <= 0) return 'not_started';
  return current >= target ? 'met' : 'countdown';
}

/** A node "has grown its own team" when ≥ 4 of its direct children have themselves reached leg
 *  depth ≥ 4 (RoB rule 4, "a team gets a life of its own when a leader emerges") — the exact same
 *  4-legs-of-depth-4 shape as the root's own `team_four_legs` chip, just evaluated one level down
 *  the tree so a genuine DOWNLINE leader (not the root) is what is being detected. */
function nodeHasOwnFourLegTeam(node: OrgTreeNode): boolean {
  const qualifiedChildLegs = node.children.filter((c) => subtreeDepth(c) >= VISION_DEPTH - 1).length;
  return qualifiedChildLegs >= 4;
}

export function computeRoBChips(tree: BuiltOrgTree): RulesOfBuildingChips {
  const totalDirectRecruits = tree.levelOneNodes.length;
  const recruitsWithOwnRecruit = tree.levelOneNodes.filter((n) => n.hasOwnRecruit).length;

  const bestLegDepth = tree.legDepths.length > 0 ? Math.max(...tree.legDepths) : 0;
  const qualifiedLegCount = tree.legDepths.filter((d) => d >= VISION_DEPTH).length;

  const leaderCandidates = tree.allNodes.filter((n) => n.level >= 1);
  const leaderCount = leaderCandidates.filter(nodeHasOwnFourLegTeam).length;

  const chips: RulesOfBuildingChip[] = [
    {
      key: 'recruit_has_recruit',
      label: "A recruit isn't a recruit until they have a recruit",
      state: totalDirectRecruits === 0 ? 'not_started' : chipState(recruitsWithOwnRecruit, totalDirectRecruits),
      countLabel: `${recruitsWithOwnRecruit} of ${Math.max(totalDirectRecruits, 1)}`,
      current: recruitsWithOwnRecruit,
      target: Math.max(totalDirectRecruits, 1),
    },
    {
      key: 'leg_four_deep',
      label: "A leg isn't a leg until it is four deep",
      state: totalDirectRecruits === 0 ? 'not_started' : chipState(bestLegDepth, VISION_DEPTH),
      countLabel: `${Math.min(bestLegDepth, VISION_DEPTH)} of ${VISION_DEPTH} deep`,
      current: Math.min(bestLegDepth, VISION_DEPTH),
      target: VISION_DEPTH,
    },
    {
      key: 'team_four_legs',
      label: "A team isn't a team until it has four legs",
      state: qualifiedLegCount === 0 ? 'not_started' : chipState(qualifiedLegCount, TEAM_LEG_COUNT),
      countLabel: `${qualifiedLegCount} of ${TEAM_LEG_COUNT} legs`,
      current: qualifiedLegCount,
      target: TEAM_LEG_COUNT,
    },
    {
      key: 'leader_emerged',
      label: 'A team gets a life of its own when a leader emerges',
      state: leaderCount === 0 ? 'not_started' : 'met',
      countLabel: leaderCount === 0 ? '0 of 1' : `${leaderCount} emerged`,
      current: leaderCount,
      target: 1,
    },
  ];

  return { chips };
}
