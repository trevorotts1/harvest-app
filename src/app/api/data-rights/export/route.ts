// T-R29 (compliance-reachability build, master-spec §16.3/§9.2 + §4.11 "GDPR/CCPA compliance").
//
// T-51 found `DataRightsService.processExport` (T-11) had ZERO production callers — the DSAR
// export was built and unit-tested but unreachable from any real route or page. This is the real,
// reachable `POST /api/data-rights/export` — it only ever CREATES the export request (status
// PENDING); the actual decrypt-and-serialize work happens in the ownership-checked
// `GET /api/data-rights/export/[exportId]` (see that route's header comment), so an export payload
// is never generated without a fresh per-request identity/ownership check immediately in front of
// it.
//
// SESSION-scoped, own-data-only BY CONSTRUCTION: this route reads no `x-user-id` (or any other
// client-supplied identity) header at all — `session.user.id`, from the VERIFIED Auth.js session
// (`withCapability`/`withStepUp`, both backed by `getCurrentSession`), is the only identity input,
// so a forged header is inert (there is nothing here that would ever read it).
//
// Row 8 of the §16.6 RBAC matrix ("Data-rights (own export/delete)") already reserved `export` as
// an allowed `Action` on the `data_rights` `Resource` for every role, and `mfa.ts` already reserved
// `'data_export'` as a step-up-MFA `SensitiveAction` (§16.4) — both un-wired until this unit. Wired
// here exactly per `with-role.ts`'s own `withCapability` usage example, composed with `withStepUp`
// the same way `/api/settings/org-switch` (WP08, the previous "wire up a reserved SensitiveAction"
// unit) composed `withRole` + `withStepUp`.
//
// Reuses T-11's `DataRightsService.requestExport` UNMODIFIED — this route only constructs the
// service (via the new `buildProductionDataRightsService` composition root, T-R29) and calls it.

import { NextResponse } from 'next/server';

import { withCapability, withStepUp } from '@/lib/auth/with-role';
import { prisma } from '@/lib/prisma';
import { buildProductionDataRightsService } from '@/services/compliance/data-rights';

export const dynamic = 'force-dynamic';

export const POST = withCapability(
  'data_rights',
  'export',
  withStepUp('data_export', async (_req, _ctx, session) => {
    const service = buildProductionDataRightsService(prisma);
    const record = await service.requestExport({ user_id: session.user.id });
    return NextResponse.json({ export: record }, { status: 201 });
  })
);
