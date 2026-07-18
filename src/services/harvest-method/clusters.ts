// WP03 §8.1 Layer 2 — the Qualities Flip's SIX quality clusters.
//
// Reconciliation (stated, not silent — uiux §5.4): the blueprint describes a paper flip with "five
// partner qualities"; the master spec (§8.1, precedence) specifies SIX. This module is the single
// source of truth for the cluster vocabulary — `ALL_QUALITY_CLUSTERS` is what every layer-2 gate
// (`method-state.service.ts`) and test (`six-clusters.test.ts`) checks length against, so a future
// edit that silently drops back to five (or grows to seven) fails a real assertion, not just a
// visual review.

import { QualityCluster } from '@prisma/client';

export interface QualityClusterDefinition {
  key: QualityCluster;
  /** Rep-facing label (uiux §5.4: "the six clusters as cards ... each with a one-line description"). */
  label: string;
  description: string;
}

/** The exact six, in the master-spec §8.1 / uiux §5.4 stated order. */
export const QUALITY_CLUSTER_DEFINITIONS: readonly QualityClusterDefinition[] = [
  {
    key: QualityCluster.COMMUNITY_HUB,
    label: 'Community Hub',
    description: 'The person everyone already turns to — connected, trusted, central to a group.',
  },
  {
    key: QualityCluster.RISING_ACHIEVER,
    label: 'Rising Achiever',
    description: 'Building something right now — ambitious, in motion, hungry to grow.',
  },
  {
    key: QualityCluster.NATURAL_TEACHER,
    label: 'Natural Teacher',
    description: 'Explains things well, patient with others, enjoys helping people understand.',
  },
  {
    key: QualityCluster.STEADY_BUILDER,
    label: 'Steady Builder',
    description: 'Consistent, dependable, plays the long game rather than chasing quick wins.',
  },
  {
    key: QualityCluster.HEART_OF_GOLD,
    label: 'Heart of Gold',
    description: 'Generous, service-minded, shows up for people without being asked.',
  },
  {
    key: QualityCluster.QUIET_INFLUENCER,
    label: 'Quiet Influencer',
    description: "Doesn't seek the spotlight, but people quietly take their cue from them.",
  },
] as const;

/** The closed six-value vocabulary itself — governs over any five-quality reading (§8.1, uiux §5.4). */
export const ALL_QUALITY_CLUSTERS: readonly QualityCluster[] = QUALITY_CLUSTER_DEFINITIONS.map((d) => d.key);

export const QUALITY_CLUSTER_COUNT = ALL_QUALITY_CLUSTERS.length;

export function isValidQualityCluster(value: unknown): value is QualityCluster {
  return typeof value === 'string' && (ALL_QUALITY_CLUSTERS as string[]).includes(value);
}

/** Safely coerces a Prisma `Json` column value (or any untrusted input) to a `QualityCluster[]`,
 *  dropping anything outside the six-value vocabulary rather than throwing — used everywhere a
 *  `ContactMethodProfile.clusters` JSONB value is read back. */
export function toClusterArray(raw: unknown): QualityCluster[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidQualityCluster);
}

export function clusterLabel(key: QualityCluster): string {
  return QUALITY_CLUSTER_DEFINITIONS.find((d) => d.key === key)?.label ?? key;
}
