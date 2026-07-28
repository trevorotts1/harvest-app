// T-R56 (admin console — item 5, AUDIT / SECURITY VIEWER, read-only, ADMIN-only): GET
// /api/admin/audit — paginated AuditEntry rows (?kind=audit, default, alongside the hash-chain
// integrity verdict) or SecurityEvent rows (?kind=security). Gated on `cross_org`/`read`
// (ADMIN-only per §16.6), same rationale as the signups/activity dashboards — this is org-wide,
// cross-account evidence.
//
// `chainIntegrity` (audit kind only) is `AuditService.verifyStoredChain()`'s live re-verification
// (`src/services/compliance/audit/hash-chain.ts`) — this is what lets an operator SEE the
// tamper-evidence proof, not merely trust that a chain exists. Computed against the FULL store
// (not just the current page) so paging never changes the verdict.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withCapability } from '@/lib/auth/with-role';
import { buildProductionAuditViewerService } from '@/services/admin/production';

export const dynamic = 'force-dynamic';

export const GET = withCapability('cross_org', 'read', async (req) => {
  const params = req.nextUrl.searchParams;
  const kind = params.get('kind') === 'security' ? 'security' : 'audit';
  const page = params.get('page') ? Number(params.get('page')) : undefined;
  const pageSize = params.get('pageSize') ? Number(params.get('pageSize')) : undefined;

  const service = buildProductionAuditViewerService(prisma);

  if (kind === 'security') {
    const result = await service.listSecurityEvents({ page, pageSize });
    return NextResponse.json({ kind, ...result });
  }

  const [result, chainIntegrity] = await Promise.all([
    service.listAuditEntries({}, { page, pageSize }),
    service.verifyAuditChain(),
  ]);
  return NextResponse.json({ kind, ...result, chainIntegrity });
});
