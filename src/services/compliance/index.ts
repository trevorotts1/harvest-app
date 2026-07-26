// Compliance Filter Engine (CFE) — master-spec §5. Public surface.
export { ComplianceFilterEngine } from './engine';
export type { CFEEngineDeps } from './engine';
export {
  HaikuClassifierClient,
  LocalDeterministicClassifierClient,
  MissingClaudeCredentialError,
  ClassifierTimeoutError,
  ClaudeClassifierError,
} from './claude';
export type { ClaudeClassifierClient, ClassifierRequest, HaikuClientOptions } from './claude';
// T-R51 (OBSERVE variant, operator-authorized §0.3 scoped exception): the Agnes classifier client
// — see `./agnes/agnes-client.ts` and `CFEEngineDeps.classifierClient`'s doc comment in `engine.ts`.
export { AgnesClassifierClient, MissingAgnesCredentialError, AgnesClassifierError } from './agnes';
export type { AgnesClientOptions } from './agnes';
export { buildClassifiers, BaseHaikuClassifier } from './classifiers';
export { VocabularyClassifier, FORBIDDEN_TERMS, FORBIDDEN_TERMS_ES, FORBIDDEN_TERMS_ALL } from './vocabulary';
export type { VocabularyViolation, VocabularyScan, ForbiddenTermRule } from './vocabulary';
export {
  evaluateClassifierRules,
  strictestBand,
  RULE_THRESHOLDS,
  REVIEW_ESCALATION_FLOOR,
} from './config/classifier-rules';
export { CLASSIFIER_CONFIG } from './config/classifier-config';
// T-R51: §0.5 doctrine-vocabulary OBSERVE-mode config resolution.
export { getVocabularyMode } from './config/vocabulary-mode';
export { NoopCFEAuditSink, InMemoryCFEAuditSink } from './audit/audit-sink';
export type { CFEAuditSink } from './audit/audit-sink';

// The immutable, hash-chained audit store + rep-visible Activity Ledger (T-10, §5.6/§5.7/§17.8).
export {
  AuditService,
  InMemoryAuditRepository,
  PrismaAuditRepository,
  deriveRegulationTag,
  DurableCFEAuditSink,
  DurableLicensingEventSink,
  DurableDataRightsAuditSink,
  createDurableAuditSinks,
  ActivityLedgerService,
  ActivityLedgerAccessDeniedError,
  OWN_ONLY_SCOPE_RESOLVER,
  computeEntryHash,
  verifyChain,
  deepFreeze,
  computeCheckpointHash,
  verifyAnchoring,
  InMemoryAuditCheckpointRepository,
  PrismaAuditCheckpointRepository,
} from './audit';
export type {
  AuditEntryRecord,
  AuditQueryFilters,
  AuditRepository,
  RecordAuditEventInput,
  ActivityLedgerCaller,
  ActivityLedgerQuery,
  DownlineScopeResolver,
  ChainVerificationResult,
  AuditCheckpoint,
  AuditCheckpointRepository,
  AnchoringVerificationResult,
} from './audit';
