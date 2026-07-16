// The immutable, hash-chained audit store (T-10, master-spec §5.6/§5.7/§16.1/§17.8). Public surface.

export {
  AuditService,
  InMemoryAuditRepository,
  PrismaAuditRepository,
  deriveRegulationTag,
  mapChannelForPersistence,
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
