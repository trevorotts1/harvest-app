import type { PrismaClient } from '@prisma/client';

import { AuditService, PrismaAuditRepository, type AuditEntryPrismaDelegate } from '@/services/compliance/audit/audit-service';
import { ActivityLedgerService } from '@/services/compliance/audit/activity-ledger';
import { UserManagementService, type UserManagementPrismaDelegate } from './user-management.service';
import { AuditViewerService, type SecurityEventPrismaDelegate } from './audit-viewer.service';

/**
 * T-R56 (admin console) production composition root — mirrors
 * `src/services/compliance/data-rights/production.ts`'s convention exactly: pure composition of
 * already-tested pieces (`UserManagementService`, `AuditService`, `ActivityLedgerService`) against
 * the REAL Prisma client, constructed lazily INSIDE a request handler (never at module scope).
 */
export function buildProductionAuditService(client: PrismaClient): AuditService {
  return new AuditService(new PrismaAuditRepository(client as unknown as { auditEntry: AuditEntryPrismaDelegate }));
}

export function buildProductionUserManagementService(client: PrismaClient): UserManagementService {
  return new UserManagementService(
    client.user as unknown as UserManagementPrismaDelegate,
    buildProductionAuditService(client)
  );
}

export function buildProductionActivityLedgerService(client: PrismaClient): ActivityLedgerService {
  return new ActivityLedgerService(new PrismaAuditRepository(client as unknown as { auditEntry: AuditEntryPrismaDelegate }));
}

export function buildProductionAuditViewerService(client: PrismaClient): AuditViewerService {
  return new AuditViewerService(
    buildProductionAuditService(client),
    client.securityEvent as unknown as SecurityEventPrismaDelegate
  );
}
