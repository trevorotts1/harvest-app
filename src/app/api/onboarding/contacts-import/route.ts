import { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withRole } from '@/lib/auth/with-role';
import { ContactSource } from '@/types/warm-market';
import { ImportLimitExceededError } from '@/services/warm-market/vault/csv-parser';
import { VaultService, type VaultPrismaClient } from '@/services/warm-market/vault/vault.service';

// T-R30 (parity GAP 1, T-51: onboarding's CSV import was faked — `OnboardingFlow.tsx`'s `onUseCsv`
// set `contactCount=24` and never read a file). This is the REAL onboarding-time CSV ingestion
// endpoint: same Vault pipeline as `/api/contacts/import` (AES-256-GCM PII encryption, keyed-HMAC
// dedupe, resumable/idempotent batches, minors gate — VaultService, T-22) — never a parallel
// unencrypted contact path.
//
// Deliberately built on `withRole` (the REAL Auth.js session via `getCurrentSession`) — NOT
// `withOnboardingGate`. `withOnboardingGate` requires `onboarding_status === GATED_COMPLETE`, which
// would make this route unreachable during the O-7 "contacts" onboarding screen, since onboarding is
// BY DEFINITION not yet complete there. Same posture — and the same documented rationale — as
// `/api/onboarding/consent/route.ts` (T-21R): "is there a valid, authenticated session at all" is the
// only authorization question during onboarding; every role may import into their OWN Vault, so the
// allow-list is intentionally every role in the enum. The POST-onboarding self-serve import surface
// (`/community/import`, calling `/api/contacts/import`) stays behind the full `withOnboardingGate`.
//
// This route neither reads nor trusts any `x-user-*` header — the caller's id comes only from the
// verified session (`session.user.id`), same as every other real route in this codebase.
export const dynamic = 'force-dynamic';

const ALL_ROLES = Object.values(Role);

interface OnboardingCsvImportBody {
  csvText?: string;
  idempotencyKey?: string;
}

export const POST = withRole(ALL_ROLES, async (req: NextRequest, _ctx, session) => {
  let body: OnboardingCsvImportBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.csvText || typeof body.csvText !== 'string' || body.csvText.trim().length === 0) {
    return NextResponse.json({ error: '"csvText" is required — read the selected file as text first' }, { status: 400 });
  }
  if (!body.idempotencyKey || typeof body.idempotencyKey !== 'string') {
    return NextResponse.json(
      {
        error:
          '"idempotencyKey" is required — mint one per logical import attempt and reuse it on retry ' +
          'so a resumed/repeated import is idempotent (§18.5).',
      },
      { status: 400 }
    );
  }

  const vaultService = new VaultService(prisma as unknown as VaultPrismaClient);

  try {
    const result = await vaultService.importBatch(session.user.id, ContactSource.CSV, undefined, {
      idempotencyKey: body.idempotencyKey,
      clientPlatform: 'web',
      csvText: body.csvText,
    });

    return NextResponse.json(
      {
        batchId: result.batchId,
        source: result.source,
        status: result.status,
        totalRows: result.totalRows,
        processed: result.cursor,
        importedCount: result.importedCount,
        mergedCount: result.mergedCount,
        minorFlaggedCount: result.minorFlaggedCount,
        errorRows: result.errorRows,
        resumable: result.resumable,
        idempotentReplay: result.idempotentReplay,
      },
      { status: result.status === 'COMPLETED' ? 201 : 202 }
    );
  } catch (err) {
    if (err instanceof ImportLimitExceededError) {
      return NextResponse.json({ error: err.message, code: 'IMPORT_LIMIT_EXCEEDED' }, { status: 413 });
    }
    throw err;
  }
});
