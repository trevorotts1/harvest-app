export { DataRightsService } from './data-rights';
export type { DataRightsPrismaClient } from './data-rights';

// T-R29 (compliance-reachability build) — the production composition root the new
// `src/app/api/data-rights/**` routes construct per-request. See production.ts's doc comment.
export { buildProductionDataRightsService } from './production';

export { RetentionService, retentionService } from './retention';
export type { RetentionRecordRef, PastRetentionResult } from './retention';

export {
  LegalHoldService,
  PrismaLegalHoldRepository,
  InMemoryLegalHoldRepository,
} from './legal-hold';
export type { LegalHoldRepository, LegalHoldPrismaDelegate } from './legal-hold';

export { enforceMinimization, isMinimized, allowlistFor } from './minimization';
export type { MinimizationResult } from './minimization';

export {
  InMemoryDataRightsAuditSink,
  buildDataRightsAuditEvent,
} from './audit-emit';
export type { DataRightsAuditEvent, DataRightsAuditEventType, DataRightsAuditSink } from './audit-emit';

export type {
  DataCategory,
  RetentionRule,
  RetentionAction,
  RetentionBasis,
  LegalHoldStatus,
  LegalHoldRecord,
  DeletionStatus,
  DeletionCertificate,
  RetainedRecordRef,
  UserDataDeletionRecord,
  ExportStatus,
  ExportFormat,
  UserDataExportRecord,
  MinimizationSurface,
} from '../../../types/data-rights';
export {
  RETENTION_SCHEDULE,
  MINIMIZATION_ALLOWLIST,
  DELETION_CONFIRMATION_COOLING_OFF_HOURS,
} from '../../../types/data-rights';
