// WP01 §6.4 — Seven Whys (Flow C) public surface. See ./engine.ts for the reading-order summary.

export {
  SEVEN_WHYS_LEVELS,
  SEVEN_WHYS_MODEL_ID,
  SEVEN_WHYS_RESONANCE_GATE,
  FIRST_SEVEN_WHYS_LEVEL,
  LAST_SEVEN_WHYS_LEVEL,
  SevenWhysLevel,
  SEVEN_WHYS_TURN_JSON_SCHEMA,
  SEVEN_WHYS_ANCHOR_JSON_SCHEMA,
} from './types';
export type {
  SevenWhysConversationState,
  SevenWhysConversationStatus,
  SevenWhysLevelRecord,
  SevenWhysRenderedTurn,
  SevenWhysTranscriptEntry,
  SevenWhysConverseRequest,
  SevenWhysConverseResult,
  SevenWhysAnchorRequest,
  SevenWhysAnchorResult,
} from './types';

export {
  SonnetConversationClient,
  SevenWhysConversationError,
  SevenWhysTimeoutError,
  MissingClaudeCredentialError,
} from './claude-client';
export type {
  SevenWhysConversationClient,
  SonnetConversationClientOptions,
} from './claude-client';

export { LocalSevenWhysConversationClient } from './local-conversation-client';

export { estimateDepthSignal, aggregateResonance } from './resonance';

export { finalizeAnchorStatement, SevenWhysAnchorVocabViolationError } from './anchor';

export {
  startSevenWhys,
  renderCurrentTurn,
  submitSevenWhysAnswer,
} from './engine';
export type { SevenWhysEngineState, SevenWhysTurnOutcome } from './engine';

export { routeAnchorToOutreach } from './outreach-gate';
export type { CFEContentEvaluator, AnchorOutreachDecision } from './outreach-gate';

export {
  saveSevenWhysProgress,
  setOutreachConsent,
  decryptAnchorStatement,
  decryptTranscript,
  getWhySessionEncryptionKey,
  WHY_SESSION_ENCRYPTION_KEY_ENV_VAR,
} from './persistence';
export type { WhySessionRow, WhySessionPrismaClient } from './persistence';
