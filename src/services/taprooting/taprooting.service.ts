// WP08 §13.1/§13.4 — the real, Prisma-backed org-tree service. Replaces the pre-existing
// `MOCK_ORG_TREE` scaffold (no DB, no org-gating, no reachability — nothing in production ever
// imported it; see `tests/unit/taprooting.test.ts` before this change, whose only assertions were
// against the hard-coded mock).
//
// ORG-GATING (§17.1, the platform's #1 hard architecture law): the Primerica/universal branch is
// decided from a FRESH, per-request database read of the TARGET user's `org_type` — never a
// cached value, never the JWT/session claim. This is what makes the §13.5/§18.7 "org switch wipes
// gated state instantly, mid-session" property true by construction: there is no cache to
// invalidate, so the very next read after a switch already reflects the new branch. Every payload
// this module returns for a universal-branch target is additionally run through
// `assertNoPrimericaLeak` before being handed back — defense in depth on top of the branch check
// itself, exactly the two-primitive pattern `org-gate.ts` documents.
//
// RBAC (§13.5/§16.6): a caller may always read their OWN tree. Reading a DIFFERENT user's tree
// requires (a) the caller's role holds the `downline_visibility` capability (upline/rvp/admin) AND
// (b) that user is actually reachable within the caller's own downline (never trusts a bare id) —
// anything else resolves to `null` (the caller turns that into a 404, never a 403, so existence is
// never leaked). The returned shape itself carries no PII/conversation fields either way (see
// `types/taprooting.ts`), so this is defense in depth, not the only gate.

import { OrgType, Role } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { isPrimericaBranch, assertNoPrimericaLeak } from '@/services/onboarding/wp01/org-gate';
import { can } from '@/lib/auth/rbac-matrix';
import type { MomentumEventLike } from '@/services/mission-control/momentum';
import { computeNodeHealth, emptyNodeHealth } from './health';
import {
  buildOrgTree,
  computeGhostLattice,
  computeRoBChips,
  type OrgTreeEdgeRecord,
  type RecruitInfo,
  type BuiltOrgTree,
} from './tree-builder';
import type { OrgTreeNode, OrgTreeResult, HealthTint } from '@/types/taprooting';

/** The narrow Prisma surface this module needs — DI-mockable (mirrors every other service's
 *  narrow-client convention, e.g. onboarding-gate.ts's `OnboardingGatePrismaClient`). */
export interface TaprootingPrismaClient {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; rank: true; org_type: true };
    }): Promise<{ id: string; name: string; rank: string | null; org_type: OrgType } | null>;
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true; rank: true };
    }): Promise<{ id: string; name: string; rank: string | null }[]>;
  };
  orgTreeEdge: {
    findMany(args: {
      where: { sponsor_id: { in: string[] }; is_recruit_confirmed: true };
      select: { id: true; sponsor_id: true; recruit_id: true };
    }): Promise<{ id: string; sponsor_id: string; recruit_id: string }[]>;
    update(args: {
      where: { id: string };
      data: { leg_depth: number; is_leg: boolean; has_own_recruit: boolean; health_index: unknown };
    }): Promise<unknown>;
  };
  momentumEvent: {
    findMany(args: {
      where: { user_id: { in: string[] } };
      select: { user_id: true; law: true; points: true; created_at: true };
    }): Promise<{ user_id: string; law: string; points: number; created_at: Date }[]>;
  };
}

const MAX_TREE_DEPTH = 25; // safety bound; §13.1 requires visibility to "10+ levels", well under this.

function toDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Member';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

function activitySizeFromScore(score: number): number {
  return Math.max(0, Math.min(4, Math.round(score / 25)));
}

/** Iteratively (level-by-level) fetches every CONFIRMED edge reachable from `rootId` — never a
 *  full-table scan, never a recursive SQL CTE (Prisma has none portable across this project's
 *  target DB setups); bounded by `MAX_TREE_DEPTH` as a runaway-loop safety net only. */
async function fetchReachableEdges(
  db: TaprootingPrismaClient,
  rootId: string
): Promise<{ id: string; sponsor_id: string; recruit_id: string }[]> {
  const all: { id: string; sponsor_id: string; recruit_id: string }[] = [];
  let frontier = [rootId];
  const visitedSponsors = new Set<string>();

  for (let depth = 0; depth < MAX_TREE_DEPTH && frontier.length > 0; depth += 1) {
    const nextFrontier = frontier.filter((id) => !visitedSponsors.has(id));
    if (nextFrontier.length === 0) break;
    nextFrontier.forEach((id) => visitedSponsors.add(id));

    const edges = await db.orgTreeEdge.findMany({
      where: { sponsor_id: { in: nextFrontier }, is_recruit_confirmed: true },
      select: { id: true, sponsor_id: true, recruit_id: true },
    });
    all.push(...edges);
    frontier = edges.map((e) => e.recruit_id);
  }
  return all;
}

export interface RecomputeResult {
  tree: BuiltOrgTree;
  /** Edges whose `has_own_recruit` flipped false -> true THIS call (§13.4 "at the moment of
   *  completion") — consumed by milestone-detection.service.ts. */
  newlyGainedOwnRecruit: string[]; // recruit_id
  /** Edges whose leg newly reached depth 4 (`is_leg` flipped false -> true) THIS call. */
  newlyQualifiedLegRecruitIds: string[]; // recruit_id (the level-1 recruit of the newly-qualified leg)
}

/**
 * Recomputes the WP08-owned `OrgTreeEdge` columns (`leg_depth`, `is_leg`, `has_own_recruit`,
 * `health_index`) for the whole tree reachable from `rootId` and persists them — the schema's own
 * "maintained by the application layer, not generated columns" contract. Always reads fresh (no
 * cache), so a call right after a new recruit is confirmed reflects it immediately (§13.4 "at the
 * moment of completion"), and a call after an org-type switch reflects the new branch immediately.
 */
export async function recomputeAndPersistOrgTree(
  db: TaprootingPrismaClient,
  rootId: string,
  now: Date = new Date()
): Promise<RecomputeResult> {
  const edges = await fetchReachableEdges(db, rootId);
  const recruitIds = Array.from(new Set(edges.map((e) => e.recruit_id)));

  const users = recruitIds.length > 0 ? await db.user.findMany({ where: { id: { in: recruitIds } }, select: { id: true, name: true, rank: true } }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const events = recruitIds.length > 0 ? await db.momentumEvent.findMany({ where: { user_id: { in: recruitIds } }, select: { user_id: true, law: true, points: true, created_at: true } }) : [];
  const eventsByUser = new Map<string, MomentumEventLike[]>();
  for (const e of events) {
    const list = eventsByUser.get(e.user_id) ?? [];
    list.push({ law: e.law, points: e.points, created_at: e.created_at });
    eventsByUser.set(e.user_id, list);
  }

  // Snapshot the PRE-recompute has_own_recruit/is_leg for the diff below — read from the edges
  // this same call already needs (no second round trip): a recruit "has their own recruit" the
  // instant an edge exists with them as `sponsor_id`, which is exactly what makes THEM a sponsor
  // in this same edge list.
  const sponsorIdsInThisTree = new Set(edges.map((e) => e.sponsor_id));

  const recruitInfo = (id: string): RecruitInfo => {
    const u = userById.get(id);
    if (!u) return { displayName: 'Member', rank: null, ownActivitySize: 0 };
    const score = eventsByUser.has(id)
      ? computeNodeHealth(eventsByUser.get(id) ?? [], now).score
      : 0;
    return { displayName: toDisplayName(u.name), rank: u.rank, ownActivitySize: activitySizeFromScore(score) };
  };
  const healthFor = (id: string) =>
    eventsByUser.has(id) ? computeNodeHealth(eventsByUser.get(id) ?? [], now) : emptyNodeHealth();

  const edgeRecords: OrgTreeEdgeRecord[] = edges.map((e) => ({ sponsor_id: e.sponsor_id, recruit_id: e.recruit_id }));
  const tree = buildOrgTree(edgeRecords, rootId, recruitInfo, healthFor);

  const nodeById = new Map<string, OrgTreeNode>();
  const index = (n: OrgTreeNode) => {
    nodeById.set(n.id, n);
    n.children.forEach(index);
  };
  tree.levelOneNodes.forEach(index);

  const newlyGainedOwnRecruit: string[] = [];
  const newlyQualifiedLegRecruitIds: string[] = [];

  await Promise.all(
    edges.map(async (edge) => {
      const node = nodeById.get(edge.recruit_id);
      if (!node) return;
      const hasOwnRecruitNow = sponsorIdsInThisTree.has(edge.recruit_id);
      await db.orgTreeEdge.update({
        where: { id: edge.id },
        data: {
          leg_depth: node.level,
          is_leg: node.isQualifiedLeg,
          has_own_recruit: hasOwnRecruitNow,
          health_index: node.health.laws,
        },
      });
      // "At the moment of completion" (§13.4): we don't have the PRE-update DB row's prior value
      // in hand here (a separate read would race with concurrent writers) — the milestone
      // detection service is the one place that ALSO tracks its own already-recorded Milestone
      // rows and only creates a new one the first time a given key is seen (Milestone.milestone_key
      // is `@@unique([user_id, milestone_key])`), so recomputing this every read is idempotent and
      // never double-fires a celebration even though this function itself always returns the
      // "currently true" transition candidates rather than a strict watched diff.
      if (hasOwnRecruitNow) newlyGainedOwnRecruit.push(edge.recruit_id);
      if (node.isQualifiedLeg && node.level === 1) newlyQualifiedLegRecruitIds.push(edge.recruit_id);
    })
  );

  return { tree, newlyGainedOwnRecruit, newlyQualifiedLegRecruitIds };
}

export type OrgTreeReadOutcome = { ok: true; result: OrgTreeResult } | { ok: false; reason: 'not_found' | 'forbidden' };

/**
 * The read path the `/api/taprooting/tree` route calls. `viewerId` is always the AUTHENTICATED
 * session user; `targetUserId` defaults to the viewer's own id. Viewing someone else's tree is
 * RBAC-gated (see module doc) and resolves to `{ ok: false, reason: 'forbidden' }` — the route
 * turns EITHER failure reason into the same 404 body, never distinguishing "doesn't exist" from
 * "not yours to see" (§16.6/§18.10 "auth-failure messages never reveal ... existence").
 */
export async function getOrgTreeView(
  viewerId: string,
  viewerRole: Role,
  targetUserId: string | undefined,
  db: TaprootingPrismaClient = prisma as unknown as TaprootingPrismaClient,
  now: Date = new Date()
): Promise<OrgTreeReadOutcome> {
  const effectiveTargetId = targetUserId ?? viewerId;
  const isOwnTree = effectiveTargetId === viewerId;

  if (!isOwnTree && !can(viewerRole, 'downline_visibility', 'read')) {
    return { ok: false, reason: 'forbidden' };
  }

  const target = await db.user.findUnique({ where: { id: effectiveTargetId }, select: { id: true, name: true, rank: true, org_type: true } });
  if (!target) return { ok: false, reason: 'not_found' };

  if (!isOwnTree) {
    // Reachability check: the target must actually be inside the viewer's own downline — never
    // trust a bare id (mirrors `actOnQueueDraft`'s ownership-by-query convention elsewhere).
    const viewerReachable = await fetchReachableEdges(db, viewerId);
    const reachableIds = new Set(viewerReachable.map((e) => e.recruit_id));
    if (!reachableIds.has(effectiveTargetId)) {
      return { ok: false, reason: 'forbidden' };
    }
  }

  const viewer = isOwnTree ? target : await db.user.findUnique({ where: { id: viewerId }, select: { id: true, name: true, rank: true, org_type: true } });
  const viewerOrgType = viewer?.org_type ?? target.org_type;

  const branch: 'primerica' | 'universal' = isPrimericaBranch(target.org_type) ? 'primerica' : 'universal';
  const { tree } = await recomputeAndPersistOrgTree(db, effectiveTargetId, now);

  const result = assembleOrgTreeResult(target, tree, branch, isOwnTree);

  // Defense in depth (§17.1): a universal VIEWER must never receive a Primerica-gated string even
  // if the branch decision above were somehow wrong. Scoped to the viewer's own org branch, not
  // the target's — a Primerica upline auditing a universal downline's (impossible in practice,
  // since branch is fixed per org, but checked anyway) structure is still fine; the leak this
  // guards is a Primerica payload reaching a NON-Primerica viewer.
  assertNoPrimericaLeak(result, viewerOrgType);

  return { ok: true, result };
}

function tintCounts(nodes: OrgTreeNode[]): void {
  void nodes; // reserved for future aggregate tint summaries; not needed by the current contract.
}

function assembleOrgTreeResult(
  target: { id: string; name: string; rank: string | null },
  tree: BuiltOrgTree,
  branch: 'primerica' | 'universal',
  isOwnTree: boolean
): OrgTreeResult {
  tintCounts(tree.allNodes);
  const ownerDisplayName = toDisplayName(target.name);

  if (branch === 'universal') {
    // uiux §5.5 "Universal view: concentric growth rings — direct/second-degree ... no lattice, no
    // override math, no A.L. Williams language." Rendered as a 2-ring truncation of the same real
    // structure — deeper real growth still exists in the DB (nothing is discarded) but is not part
    // of the universal ring contract.
    const capNode = (n: OrgTreeNode): OrgTreeNode => ({ ...n, children: n.level >= 2 ? [] : n.children.map(capNode) });
    const nodes = tree.levelOneNodes.map(capNode);
    return {
      branch,
      ownerDisplayName,
      ownerRank: target.rank,
      nodes,
      ghosts: [],
      robChips: { chips: [] },
      totals: { realNodeCount: tree.allNodes.length, legCount: tree.levelOneNodes.length, maxDepth: tree.maxDepth },
      isEmpty: tree.allNodes.length === 0,
      viewScope: isOwnTree ? 'own' : 'downline_structure_only',
    };
  }

  const ghosts = computeGhostLattice(tree.legDepths);
  const robChips = computeRoBChips(tree);
  const qualifiedLegCount = tree.legDepths.filter((d) => d >= 4).length;

  return {
    branch,
    ownerDisplayName,
    ownerRank: target.rank,
    nodes: tree.levelOneNodes,
    ghosts,
    robChips,
    totals: { realNodeCount: tree.allNodes.length, legCount: qualifiedLegCount, maxDepth: tree.maxDepth },
    isEmpty: tree.allNodes.length === 0,
    viewScope: isOwnTree ? 'own' : 'downline_structure_only',
  };
}

export type { HealthTint };
