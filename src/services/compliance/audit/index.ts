// The immutable, hash-chained audit store (T-10, master-spec §5.6/§5.7/§16.1/§17.8). Public surface.

export {
  AuditService,
  InMemoryAuditRepository,
  PrismaAuditRepository,
  deriveRegulationTag,
  mapChannelForPersistence,
  deepFreeze,
} from './audit-service';
export type {
  AuditEntryRecord,
  AuditQueryFilters,
  AuditRepository,
  AuditEntryPrismaDelegate,
  RecordAuditEventInput,
} from './audit-service';

export { computeEntryHash, verifyChain, stableStringify, GENESIS_PREV_HASH } from './hash-chain';
export type { HashableEntryFields, ChainedEntry, ChainVerificationResult } from './hash-chain';

// T-R4 (WP11 audit hardening): external anchoring / tail-truncation detection. Public surface.
export {
  computeCheckpointHash,
  verifyAnchoring,
  InMemoryAuditCheckpointRepository,
  PrismaAuditCheckpointRepository,
} from './anchoring';
export type {
  AuditCheckpoint,
  HashableCheckpointFields,
  AuditCheckpointRepository,
  AuditCheckpointPrismaDelegate,
  AnchoringVerificationResult,
  AnchoringQueryableStore,
} from './anchoring';

export { NoopCFEAuditSink, InMemoryCFEAuditSink } from './audit-sink';
export type { CFEAuditSink } from './audit-sink';

export {
  DurableCFEAuditSink,
  DurableLicensingEventSink,
  DurableDataRightsAuditSink,
  createDurableAuditSinks,
  mapCfeEventToAuditInput,
  mapLicensingEventToAuditInput,
  mapDataRightsEventToAuditInput,
} from './sinks';

export {
  ActivityLedgerService,
  ActivityLedgerAccessDeniedError,
  OWN_ONLY_SCOPE_RESOLVER,
} from './activity-ledger';
export type {
  ActivityLedgerCaller,
  ActivityLedgerQuery,
  DownlineScopeResolver,
} from './activity-ledger';
