// T-23 (§7.2) — deterministic, offline segmentation client (no API key required).
//
// Mirrors `LocalDeterministicClassifierClient` (src/services/compliance/claude/local-classifier-
// client.ts, T-08) and `LocalSevenWhysConversationClient` (WP01): NOT the production path —
// production wires `AgnesSegmentationClient` (§4.4, T-R55b). It exists so relationship-type inference and
// the segment-score pipeline can be exercised in tests and local dev without a live key. It never
// contacts any provider at all.

import { RelationshipType } from '../../../types/warm-market';
import { SegmentationClient, SegmentationRequest, SegmentationResult } from './client';

/** Ordered so the first (most specific) match wins — e.g. "former colleague" before "work". */
const HINT_PATTERNS: Array<{ type: RelationshipType; pattern: RegExp }> = [
  {
    type: RelationshipType.FAMILY,
    pattern:
      /\b(mom|dad|mother|father|sister|brother|aunt|uncle|cousin|grandma|grandpa|grandmother|grandfather|son|daughter|wife|husband|spouse|family)\b/i,
  },
  {
    type: RelationshipType.CHURCH,
    pattern: /\b(church|pastor|congregation|bible study|worship|ministry|parish|synagogue|mosque)\b/i,
  },
  { type: RelationshipType.COACH, pattern: /\b(coach|trainer|instructor)\b/i },
  { type: RelationshipType.NEIGHBOR, pattern: /\b(neighbor|next door|hoa|cul-de-sac)\b/i },
  {
    type: RelationshipType.FORMER_COLLEAGUE,
    pattern: /\b(former colleague|used to work|old job|ex-coworker|previous company|former coworker)\b/i,
  },
  {
    type: RelationshipType.WORK,
    pattern: /\b(coworker|colleague|works? (at|with)|office|team lead|manager|client at work)\b/i,
  },
  {
    type: RelationshipType.FRIEND,
    pattern: /\b(friend|buddy|bestie|known (him|her|them) for years|old friend)\b/i,
  },
];

/**
 * Deterministic, offline implementation of `SegmentationClient` (§7.2). Used by tests and local dev
 * in place of `AgnesSegmentationClient` (T-R55b) — no live API key required.
 */
export class LocalDeterministicSegmentationClient implements SegmentationClient {
  async inferRelationshipType(req: SegmentationRequest): Promise<SegmentationResult> {
    const haystack = [req.hints.notes ?? '', req.hints.groupMembership ?? ''].join(' ');
    for (const { type, pattern } of HINT_PATTERNS) {
      if (pattern.test(haystack)) {
        return {
          relationshipType: type,
          confidence: 0.75,
          rationale: `matched a deterministic ${type} pattern in the available hints`,
        };
      }
    }
    if (req.hints.industry) {
      return {
        relationshipType: RelationshipType.WORK,
        confidence: 0.5,
        rationale: 'no relationship-word match, but an industry/company hint was present',
      };
    }
    return {
      relationshipType: RelationshipType.OTHER,
      confidence: 0.3,
      rationale: 'no strong signal in the available hints',
    };
  }
}
