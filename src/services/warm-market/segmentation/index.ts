// T-23 (§7.2) — Segmentation public surface.

export type { SegmentationClient, SegmentationHints, SegmentationRequest, SegmentationResult } from './client';
export { SegmentationError, SegmentationTimeoutError, RELATIONSHIP_TYPE_JSON_SCHEMA } from './client';

export { HaikuSegmentationClient, MissingClaudeCredentialError } from './haiku-client';
export type { HaikuSegmentationClientOptions } from './haiku-client';

export { LocalDeterministicSegmentationClient } from './local-client';

export {
  computeSegmentScore,
  isAList,
  recencyScore,
  lifeEventScore,
  engagementScore,
  RELATIONSHIP_TYPE_WEIGHTS,
  A_LIST_THRESHOLD,
} from './scoring';
export type { SegmentScoreInput } from './scoring';

export { SegmentationService } from './segmentation.service';
export type {
  SegmentContactResult,
  SegmentationPrismaClient,
  SegmentationContactRow,
  SegmentationInteractionRow,
} from './segmentation.service';
