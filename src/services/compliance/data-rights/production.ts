import type { PrismaClient } from '@prisma/client';

import type { AuditEntryPrismaDelegate } from '../audit/audit-service';
import { AuditService, PrismaAuditRepository } from '../audit/audit-service';
import { DurableDataRightsAuditSink } from '../audit/sinks';
import { DataRightsService, type DataRightsPrismaClient } from './data-rights';
import { LegalHoldService, PrismaLegalHoldRepository, type LegalHoldPrismaDelegate } from './legal-hold';

/**
 * Production composition root for `DataRightsService` (T-11, master-spec §16.3) — T-R29
 * (compliance-reachability build).
 *
 * T-51 found `processExport`/`processDeletion` had ZERO production callers: the service, the
 * legal-hold gate, and the durable audit-sink adapter (`../audit/sinks.ts`'s
 * `DurableDataRightsAuditSink`, whose own doc comment already anticipated this exact wiring — "production
 * wiring plugs a T-10-backed sink in here") all existed and were unit-tested, but nothing wired them
 * together against the REAL Prisma client. This file is that wiring, consumed by
 * `src/app/api/data-rights/**` — the first real API/UI callers.
 *
 * Deliberately does not touch `data-rights.ts`/`legal-hold.ts`/`audit/sinks.ts` — this is pure
 * composition (three existing, independently-tested classes constructed together), so none of
 * T-11's/T-10's own unit tests need to change.
 *
 * Lazy: callers construct this INSIDE a request handler (never at module scope), matching every
 * other per-request service construction in this codebase (e.g. `new SubscriptionService(prisma as
 * unknown as SubscriptionServicePrisma)` in `src/app/api/billing/change/route.ts`).
 */
export function buildProductionDataRightsService(client: PrismaClient): DataRightsService {
  const auditStore = new AuditService(
    new PrismaAuditRepository(client as unknown as { auditEntry: AuditEntryPrismaDelegate })
  );
  const auditSink = new DurableDataRightsAuditSink(auditStore);
  const legalHold = new LegalHoldService(
    new PrismaLegalHoldRepository(client as unknown as { legalHold: LegalHoldPrismaDelegate }),
    auditSink
  );
  return new DataRightsService(client as unknown as DataRightsPrismaClient, legalHold, auditSink);
}
