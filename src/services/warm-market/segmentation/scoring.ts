// T-23 (§7.2): "Segment score (0–100) = relationship-type weight + recency of last interaction +
// life-event indicators + engagement history. A-list = score ≥ 70; B-list < 70."
//
// The four components are weighted so their maxima sum to exactly 100 (30 + 25 + 25 + 20): no
// combination of real inputs can exceed the documented 0–100 range, so `computeSegmentScore`'s
// final clamp is a defensive belt-and-suspenders, never a normal code path.

import { RelationshipType } from '../../../types/warm-market';

/** §7.2: "A-list = score ≥ 70; B-list < 70." */
export const A_LIST_THRESHOLD = 70;

/** Relationship-type weight component (max 30) — how central this relationship tends to be to a
 * rep's warm-market Vault. Ordering mirrors §7.2's own listing: family, friend, work, church,
 * neighbor, coach, former_colleague, other. */
export const RELATIONSHIP_TYPE_WEIGHTS: Record<RelationshipType, number> = {
  [RelationshipType.FAMILY]: 30,
  [RelationshipType.FRIEND]: 26,
  [RelationshipType.COACH]: 22,
  [RelationshipType.FORMER_COLLEAGUE]: 20,
  [RelationshipType.CHURCH]: 18,
  [RelationshipType.WORK]: 16,
  [RelationshipType.NEIGHBOR]: 14,
  [RelationshipType.OTHER]: 6,
};

/** Recency component (max 25) — days since the contact's most recent logged interaction. `null`
 * means "never interacted." Never negative-credits a future/clock-skewed timestamp. */
export function recencyScore(daysSinceLastInteraction: number | null): number {
  if (daysSinceLastInteraction === null || daysSinceLastInteraction < 0) return 0;
  if (daysSinceLastInteraction <= 7) return 25;
  if (daysSinceLastInteraction <= 30) return 18;
  if (daysSinceLastInteraction <= 90) return 10;
  if (daysSinceLastInteraction <= 365) return 4;
  return 0;
}

/** Distinct life-event categories the notes field is scanned for (§7.2 "life-event indicators"). */
const LIFE_EVENT_PATTERNS: Record<string, RegExp> = {
  new_job: /\b(new job|promotion|promoted|got hired|starting a business|career change)\b/i,
  marriage: /\b(married|engaged|wedding|fianc[ée]e?)\b/i,
  baby: /\b(pregnant|expecting|newborn|new baby|had a baby)\b/i,
  moved: /\b(moved|relocat(ed|ing)|new house|new home)\b/i,
  retirement: /\b(retir(ed|ing|ement))\b/i,
};

/** Life-event component (max 25) — 5 points per distinct matched life-event category, in the
 * contact's own (decrypted) notes field. */
export function lifeEventScore(notes: string | null): number {
  if (!notes) return 0;
  let matched = 0;
  for (const pattern of Object.values(LIFE_EVENT_PATTERNS)) {
    if (pattern.test(notes)) matched++;
  }
  return Math.min(25, matched * 5);
}

/** Engagement component (max 20) — total logged `ContactInteraction` rows. */
export function engagementScore(interactionCount: number): number {
  if (interactionCount >= 11) return 20;
  if (interactionCount >= 6) return 16;
  if (interactionCount >= 3) return 12;
  if (interactionCount >= 1) return 6;
  return 0;
}

export interface SegmentScoreInput {
  relationshipType: RelationshipType;
  /** `null` = no interaction on record yet. */
  daysSinceLastInteraction: number | null;
  /** Decrypted plaintext notes (never ciphertext — see vault/vault-encryption.ts). */
  notes: string | null;
  interactionCount: number;
}

/** §7.2 segment score (0–100). */
export function computeSegmentScore(input: SegmentScoreInput): number {
  const total =
    RELATIONSHIP_TYPE_WEIGHTS[input.relationshipType] +
    recencyScore(input.daysSinceLastInteraction) +
    lifeEventScore(input.notes) +
    engagementScore(input.interactionCount);
  return Math.max(0, Math.min(100, total));
}

/** §7.2: "A-list = score ≥ 70." */
export function isAList(segmentScore: number): boolean {
  return segmentScore >= A_LIST_THRESHOLD;
}
