// T-R29 (compliance-reachability build, master-spec §16.3/§9.2) — `GET /api/data-rights/export/
// [exportId]`: the ownership-checked download that actually runs `DataRightsService.processExport`
// (T-11's decrypt-and-serialize, T-R7/T-R9's Contact-PII decrypt + `User` secret-exclusion
// allowlist) and returns the payload as a downloadable file.
//
// OWNERSHIP / own-data-only / cross-user -> 404-not-leak: `DataRightsService.processExport` takes
// only an `export_id` — by itself it has no notion of "whose request is this", so a caller who
// merely guessed/observed another rep's `exportId` (a UUID, not secret, but never assume secrecy
// alone is the defense) must never have it processed on their behalf. This route does its OWN
// ownership read (`prisma.userDataExport.findUnique`) BEFORE ever calling the service — a row that
// does not exist AND a row that belongs to a different user both resolve to the identical 404 body
// below, exactly mirroring `/api/contacts/[contactId]/conversation`'s "never distinguish does-not-
// exist from belongs-to-someone-else" convention.
//
// SESSION-scoped: identity comes only from `session.user.id` (verified Auth.js session via
// `withCapability`/`withStepUp`) — this route reads no `x-user-id` header, so a forged one is inert.
//
// SECRET-EXCLUSION: `processExport` (data-rights.ts, T-R9) builds the `User` view from an explicit
// ALLOWLIST that omits `password_hash`/`mfa_methods` by construction and decrypts
// `solution_number`/`anchor_statement` (T-R9) plus every Contact PII field (T-R7) before
// serializing — this route calls that function UNMODIFIED and returns exactly what it produces; no
// additional field selection happens here that could either weaken or duplicate that guarantee.

import { NextResponse } from 'next/server';

import { withCapability, withStepUp } from '@/lib/auth/with-role';
import { prisma } from '@/lib/prisma';
import { buildProductionDataRightsService } from '@/services/compliance/data-rights';
import type { ExportFormat } from '@/types/data-rights';

export const dynamic = 'force-dynamic';

interface ExportRouteCtx {
  params: { exportId: string };
}

function parseFormat(value: string | null): ExportFormat {
  return value === 'csv' ? 'csv' : 'json';
}

export const GET = withCapability<ExportRouteCtx>(
  'data_rights',
  'export',
  withStepUp<ExportRouteCtx>('data_export', async (req, ctx, session) => {
    const exportId = ctx?.params?.exportId;
    if (!exportId || typeof exportId !== 'string') {
      return NextResponse.json({ error: '"exportId" is required.' }, { status: 400 });
    }

    // Ownership check FIRST — `processExport` below has no caller-identity parameter of its own.
    const existing = await prisma.userDataExport.findUnique({ where: { id: exportId } });
    if (!existing || existing.user_id !== session.user.id) {
      // Never distinguish "does not exist" from "belongs to a different rep" — both 404 identically.
      return NextResponse.json({ error: 'Export not found.' }, { status: 404 });
    }

    const format = parseFormat(new URL(req.url).searchParams.get('format'));
    const service = buildProductionDataRightsService(prisma);
    const { payload, sla_deadline } = await service.processExport(exportId, format);

    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
    return new NextResponse(payload, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="harvest-data-export-${exportId}.${format}"`,
        'X-Data-Export-Sla-Deadline': sla_deadline,
      },
    });
  })
);
