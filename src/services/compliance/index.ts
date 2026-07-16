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
export { buildClassifiers, BaseHaikuClassifier } from './classifiers';
export { VocabularyClassifier, FORBIDDEN_TERMS } from './vocabulary';
export {
  evaluateClassifierRules,
  strictestBand,
  RULE_THRESHOLDS,
  REVIEW_ESCALATION_FLOOR,
} from './config/classifier-rules';
export { CLASSIFIER_CONFIG } from './config/classifier-config';
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
} from './audit';
