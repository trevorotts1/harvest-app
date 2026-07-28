// T-23 (§7.2 "relationship-type inference ... via Haiku 4.5"; §4.4 runtime model mapping).
//
// Mirrors the DI-mockable Claude-client pattern already established twice in this codebase
// (src/services/compliance/claude/*, T-08's CFE classifiers; src/services/onboarding/wp01/
// seven-whys/claude-client.ts, WP01's conversation client): an interface the engine depends on, a
// real production implementation that calls the Anthropic Messages API (Haiku 4.5, §4.4), and a
// deterministic local implementation for tests/dev that needs no live ANTHROPIC_API_KEY.
//
// Claude-only (§0.3): the ONLY implementations of `SegmentationClient` target Haiku 4.5 or a
// deterministic local heuristic. A missing credential throws — it never falls back to a
// non-Claude provider and never silently degrades to a different model tier.

import { RelationshipType } from '../../../types/warm-market';

/** Available signal for relationship-type inference (§7.2: "notes, company, group membership"). */
export interface SegmentationHints {
  notes: string | null;
  industry: string | null;
  /** Not yet wired into any ingestion modality (T-22 CSV/iOS/Android/Google) — reserved for when a
   * future ingestion path supplies it. Always `null` from `SegmentationService` today. */
  groupMembership: string | null;
}

export interface SegmentationRequest {
  contactId: string;
  hints: SegmentationHints;
}

export interface SegmentationResult {
  relationshipType: RelationshipType;
  confidence: number;
  rationale?: string;
}

/**
 * The engine's dependency-injected boundary. `AgnesSegmentationClient` (./agnes-client.ts,
 * `agnes-2.0-flash`) is the operator-directed DEFAULT (T-R55b); `HaikuSegmentationClient`
 * (./haiku-client.ts, Anthropic) is RETAINED, UNUSED, for revertability; a deterministic local path
 * (`LocalDeterministicSegmentationClient`, ./local-client.ts) rounds out the DI boundary for
 * tests/dev.
 */
export interface SegmentationClient {
  inferRelationshipType(req: SegmentationRequest): Promise<SegmentationResult>;
}

export class SegmentationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SegmentationError';
  }
}

export class SegmentationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Segmentation inference call timed out after ${timeoutMs}ms.`);
    this.name = 'SegmentationTimeoutError';
  }
}

/** Structured-output schema for the Haiku relationship-type classification (§7.2). */
export const RELATIONSHIP_TYPE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    relationship_type: {
      type: 'string',
      enum: Object.values(RelationshipType),
    },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['relationship_type', 'confidence', 'rationale'],
} as const;
