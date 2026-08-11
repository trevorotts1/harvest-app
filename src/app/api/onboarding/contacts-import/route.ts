import { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withRole } from '@/lib/auth/with-role';
import { resolveClientPlatform } from '@/lib/client-platform';
import { ContactSource, type RawContactImportRow } from '@/types/warm-market';
import { ImportLimitExceededError } from '@/services/warm-market/vault/csv-parser';
import { decryptOptionalField } from '@/services/warm-market/vault/vault-encryption';
import {
  ModalityNotAllowedError,
  VaultService,
  type VaultPrismaClient,
} from '@/services/warm-market/vault/vault.service';

// T-R30 (parity GAP 1, T-51: onboarding's CSV import was faked — `OnboardingFlow.tsx`'s `onUseCsv`
// set `contactCount=24` and never read a file). This is the REAL onboarding-time ingestion endpoint:
// same Vault pipeline as `/api/contacts/import` (AES-256-GCM PII encryption, keyed-HMAC dedupe,
// resumable/idempotent batches, minors gate — VaultService, T-22) — never a parallel unencrypted
// contact path.
//
// T-58 additive scope: this route originally handled ONLY `source: CSV` (`csvText`). It now ALSO
// accepts `source: IOS_NATIVE | ANDROID_NATIVE` with an already-fetched+mapped `contacts` array (see
// src/services/warm-market/vault/native-contacts-adapter.ts for that mapping step and
// native-import-flow.ts for the permission-gated device read that produces it) — replacing
// OnboardingFlow.tsx's OTHER fake handler, `onRequestPermission`, which never asked OS permission and
// never read a device contact either. `source` defaults to `CSV` when omitted, so every pre-existing
// caller (which never sent a `source` field) is unaffected byte-for-byte.
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

// The only sources THIS route (onboarding-time) ever accepts — CSV (pre-existing), the two
// native-shell-only sources T-58 adds, and MANUAL (R-13's real one-at-a-time contact-entry form —
// its POST carries `contacts`, exactly like the native sources, and `assertModalityAllowed` treats
// it as a non-native source so it is web-safe by construction). Deliberately narrower than the
// general `/api/contacts/import` route's `VALID_SOURCES` (which also allows MOBILE/SOCIAL/SYNC/
// GOOGLE_OAUTH): the O-7 "contacts" onboarding screen only ever offers CSV, native, or manual, so
// a request naming any other source here is always either a bug or a forged call, not a real
// product path.
const ONBOARDING_VALID_SOURCES: ReadonlySet<string> = new Set([
  ContactSource.CSV,
  ContactSource.IOS_NATIVE,
  ContactSource.ANDROID_NATIVE,
  ContactSource.MANUAL,
]);

interface OnboardingImportBody {
  source?: string;
  csvText?: string;
  contacts?: RawContactImportRow[];
  idempotencyKey?: string;
  clientPlatform?: string;
}

export const POST = withRole(ALL_ROLES, async (req: NextRequest, _ctx, session) => {
  let body: OnboardingImportBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, { status: 400 });
  }

  // Backward-compatible default: every pre-T-58 caller never sent `source` at all and only ever
  // meant CSV.
  const source = body.source ?? ContactSource.CSV;
  if (!ONBOARDING_VALID_SOURCES.has(source)) {
    return NextResponse.json(
      { error: `"source" must be one of: ${[...ONBOARDING_VALID_SOURCES].join(', ')}`, code: 'SOURCE_INVALID' },
      { status: 400 }
    );
  }

  if (source === ContactSource.CSV) {
    if (!body.csvText || typeof body.csvText !== 'string' || body.csvText.trim().length === 0) {
      return NextResponse.json(
        { error: '"csvText" is required — read the selected file as text first', code: 'CSV_TEXT_REQUIRED' },
        { status: 400 }
      );
    }
  } else if (!Array.isArray(body.contacts)) {
    return NextResponse.json(
      {
        error:
          '"contacts" must be an array of already-mapped rows for a native or manual import — see ' +
          'native-contacts-adapter.ts\'s mapNativeContactToRow (native) or ManualAddStep (manual).',
        code: 'CONTACTS_REQUIRED',
      },
      { status: 400 }
    );
  }

  if (!body.idempotencyKey || typeof body.idempotencyKey !== 'string') {
    return NextResponse.json(
      {
        error:
          '"idempotencyKey" is required — mint one per logical import attempt and reuse it on retry ' +
          'so a resumed/repeated import is idempotent (§18.5).',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      },
      { status: 400 }
    );
  }

  // CSV always ran as `clientPlatform: 'web'` before T-58 (onboarding's CSV path is web-only) — kept
  // as the fallback default so an existing caller that never declares a platform is unaffected.
  // R-13: MANUAL is web-reachable exactly like CSV (the one-at-a-time form is a web surface;
  // `assertModalityAllowed` refuses only the native-shell sources, so a MANUAL caller needs no
  // declared platform either). Native sources have NO safe default:
  // `VaultService.assertModalityAllowed` must see the caller's OWN declared 'ios'/'android' (via
  // `resolveClientPlatform`, the same header/body convention `/api/contacts/import` already uses)
  // or it fails closed with `ModalityNotAllowedError` below.
  const clientPlatform =
    source === ContactSource.CSV || source === ContactSource.MANUAL
      ? (resolveClientPlatform(req, body) ?? 'web')
      : resolveClientPlatform(req, body);

  const vaultService = new VaultService(prisma as unknown as VaultPrismaClient);

  try {
    const result = await vaultService.importBatch(
      session.user.id,
      source as ContactSource,
      source === ContactSource.CSV ? undefined : body.contacts,
      {
        idempotencyKey: body.idempotencyKey,
        clientPlatform,
        csvText: source === ContactSource.CSV ? body.csvText : undefined,
      }
    );

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
      // §7.1 fail-closed: a native source declared from a caller that isn't actually the matching
      // native shell (e.g. a forged/mismatched `clientPlatform`) is refused — never silently
      // downgraded, never partially imported.
      return NextResponse.json({ error: err.message, code: 'MODALITY_NOT_ALLOWED' }, { status: 400 });
    }
    if (err instanceof ImportLimitExceededError) {
      // T-57 RE-GATE B [af7789d3] Finding 1 — forward the error's OWN granular code (CSV_TOO_LARGE /
      // CSV_TOO_MANY_ROWS / IMPORT_ROWS_LIMIT_EXCEEDED), not a single bucket code, so the client can
      // resolve a distinct, correctly-worded `errors.*` display string per failure kind.
      return NextResponse.json({ error: err.message, code: err.code }, { status: 413 });
    }
    throw err;
  }
});

// ── GET /api/onboarding/contacts-import ────────────────────────────────────
// T-58 addition — the dedupe surface the real "Import from Phone" selection list reads BEFORE
// presenting device contacts to the rep (§7.6 "cross-source duplicate... merge, keep most
// complete"). Session-gated only (same `withRole` posture as the POST above, for the same
// onboarding-reachability reason) and deliberately minimal: only the two fields dedupe needs
// (normalized phone/email), decrypted for the OWNER's own read (the same "the owner is the
// authorized reader of their own PII" posture `/api/contacts/import`'s GET handler already
// documents) — never the full contact record (name/notes/pipeline stage etc. are not this
// endpoint's concern and are not fetched).
export const GET = withRole(ALL_ROLES, async (_req: NextRequest, _ctx, session) => {
  const contacts = await prisma.contact.findMany({
    where: { user_id: session.user.id },
    select: { phone: true, email: true },
  });

  const keys = contacts.map((c) => ({
    phone: decryptOptionalField(c.phone),
    email: decryptOptionalField(c.email),
  }));

  return NextResponse.json({ contacts: keys });
});
