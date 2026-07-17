import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { ContactSource, type ClientPlatform, type RawContactImportRow } from '@/types/warm-market';
// T-20 §6.10-1: downstream (WP02) route, behind the real onboarding gate. `withOnboardingGate`
// resolves the caller's identity from the VERIFIED Auth.js session (never a client-forged header) —
// this file never reads `x-user-id` or any `x-user-*`/`x-auth-*`/`x-identity-*` header, so
// `scripts/verify-api-auth.mjs`'s forged-identity-header guard is moot here by construction.
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import {
  ImportLimitExceededError,
} from '@/services/warm-market/vault/csv-parser';
import { decryptContactPII } from '@/services/warm-market/vault/vault-encryption';
import {
  ModalityNotAllowedError,
  VaultService,
  type VaultPrismaClient,
} from '@/services/warm-market/vault/vault.service';

// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as session/whoami/route.ts.
export const dynamic = 'force-dynamic';

const VALID_SOURCES = new Set<string>(Object.values(ContactSource));

function resolveClientPlatform(req: NextRequest, body: { clientPlatform?: unknown }): ClientPlatform | undefined {
  const header = req.headers.get('x-harvest-platform');
  const candidate = (typeof body.clientPlatform === 'string' ? body.clientPlatform : header) ?? undefined;
  if (candidate === 'web' || candidate === 'ios' || candidate === 'android') return candidate;
  return undefined;
}

interface ImportRequestBody {
  source?: string;
  contacts?: RawContactImportRow[];
  csvText?: string;
  idempotencyKey?: string;
  clientPlatform?: string;
}

// ── POST /api/contacts/import ────────────────────────────────────
// The Vault's real ingestion endpoint (T-22, §7.1) for all four modalities: CSV (`csvText`), iOS
// native / Android native / Google OAuth (`contacts`, an already-fetched+normalized row array —
// see src/services/warm-market/vault/google-contacts-adapter.ts for the Google mapping step).
// Real Prisma persistence, AES-256-GCM-encrypted PII at rest, HMAC-deduped, resumable + idempotent
// (§18.5) via VaultService. This supersedes the earlier in-memory demo store.
export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const userId = identity.userId;

  let body: ImportRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const source = body.source;
  if (!source || !VALID_SOURCES.has(source)) {
    return NextResponse.json(
      { error: `"source" must be one of: ${[...VALID_SOURCES].join(', ')}` },
      { status: 400 }
    );
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

  const clientPlatform = resolveClientPlatform(req, body);
  const vaultService = new VaultService(prisma as unknown as VaultPrismaClient);

  try {
    const result = await vaultService.importBatch(userId, source as ContactSource, body.contacts, {
      idempotencyKey: body.idempotencyKey,
      clientPlatform,
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
    if (err instanceof ModalityNotAllowedError) {
      return NextResponse.json({ error: err.message, code: 'MODALITY_NOT_ALLOWED' }, { status: 400 });
    }
    if (err instanceof ImportLimitExceededError) {
      return NextResponse.json({ error: err.message, code: 'IMPORT_LIMIT_EXCEEDED' }, { status: 413 });
    }
    throw err;
  }
});

// ── GET /api/contacts/import ────────────────────────────────────
// Without `?batchId=`: the caller's own Vault contact list, decrypted for display (the owner is the
// authorized reader of their own PII — encryption-at-rest protects the DB/backup surface, not the
// owner's own authenticated read). With `?batchId=`: the resumability status of one import batch
// (§18.5) — lets a client poll/resume an interrupted import.
export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const userId = identity.userId;
  const batchId = req.nextUrl.searchParams.get('batchId');

  if (batchId) {
    const batch = await prisma.importBatch.findFirst({ where: { id: batchId, user_id: userId } });
    if (!batch) {
      return NextResponse.json({ error: 'Import batch not found' }, { status: 404 });
    }
    return NextResponse.json({
      batchId: batch.id,
      source: batch.source,
      status: batch.status,
      totalRows: batch.total_rows,
      processed: batch.cursor,
      importedCount: batch.imported_count,
      mergedCount: batch.merged_count,
      minorFlaggedCount: batch.minor_flagged_count,
      errorRows: batch.error_rows ?? [],
      resumable: batch.status === 'IN_PROGRESS',
    });
  }

  const contacts = await prisma.contact.findMany({ where: { user_id: userId } });
  const decrypted = contacts.map((c) => {
    const pii = decryptContactPII({
      first_name: c.first_name,
      last_name: c.last_name,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
    });
    return {
      id: c.id,
      firstName: pii.first_name,
      lastName: pii.last_name,
      phone: pii.phone,
      email: pii.email,
      notes: pii.notes,
      industry: c.industry,
      source: c.source,
      pipelineStage: c.pipeline_stage,
      segmentScore: c.segment_score,
      isMinor: c.is_minor_flag,
      doNotContact: c.do_not_contact,
      createdAt: c.created_at,
    };
  });

  return NextResponse.json({ count: decrypted.length, contacts: decrypted });
});
