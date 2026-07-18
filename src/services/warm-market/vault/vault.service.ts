// T-22 — The Vault (master-spec §7.1 "four ingestion modalities" + AES-256 encryption before
// persistence; §18.5 "interrupted import → resumable, idempotent batch"; §7.6 minors/cross-source
// dedupe edge cases). This is the orchestration layer over the single-contact primitive in
// `../contact.service.ts`: `VaultService.importBatch` is what every one of the four ingestion routes
// (CSV, iOS native, Android native, Google OAuth) calls, and it owns exactly what none of those four
// modalities can own individually — batch/idempotency bookkeeping, the native-shell-only gate, and
// cross-source merge-on-duplicate.
//
// Prisma delegate shape is intentionally narrow (same DI-mockable convention as
// `OnboardingGatePrismaClient`/`WhySessionPrismaClient` elsewhere in this codebase) so unit tests
// supply a plain mock object instead of a real Prisma client / live database.

import { MessageChannel, PrismaClient } from '@prisma/client';

import {
  ContactSource,
  NATIVE_SHELL_ONLY_SOURCES,
  PipelineStage,
  RawContactImportRow,
  type ClientPlatform,
} from '../../../types/warm-market';
import { hmacForMatch } from '../../compliance/encryption/encryption';
import { normalizeJurisdiction } from '../../harvest-method/eligibility';
import { parseContactCsv, MAX_IMPORT_ROWS, ImportLimitExceededError } from './csv-parser';
import { isMinorRow } from './minors';
import { encryptOptionalField, encryptRequiredField, getContactEncryptionKey } from './vault-encryption';

export class ModalityNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModalityNotAllowedError';
  }
}

/** A single row's terminal validation failure (§7.6 "downloadable error rows") — never an infra error. */
class RowValidationError extends Error {}

export interface ImportBatchErrorRow {
  index: number;
  reason: string;
}

export interface ImportBatchOptions {
  /** Caller-minted, reused across retries of the SAME logical import attempt (§18.5 idempotency). */
  idempotencyKey: string;
  /** Required for `IOS_NATIVE`/`ANDROID_NATIVE` — the native-shell-only gate (§7.1). */
  clientPlatform?: ClientPlatform;
  /** For `source === CSV` only: raw CSV text, parsed via `parseContactCsv` before ingestion. */
  csvText?: string;
}

export interface ImportBatchResult {
  batchId: string;
  source: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  totalRows: number;
  cursor: number;
  importedCount: number;
  mergedCount: number;
  minorFlaggedCount: number;
  errorRows: ImportBatchErrorRow[];
  /** True while `status === 'IN_PROGRESS'` — the same idempotencyKey resumes from `cursor`. */
  resumable: boolean;
  /** True when this call short-circuited on an already-`COMPLETED` batch (pure idempotent replay). */
  idempotentReplay: boolean;
}

/** Narrow Prisma delegate shape this service needs — see file header. */
export interface VaultPrismaClient {
  importBatch: {
    findUnique(args: {
      where: { user_id_idempotency_key: { user_id: string; idempotency_key: string } };
    }): Promise<ImportBatchRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<ImportBatchRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ImportBatchRow>;
  };
  contact: {
    findFirst(args: Record<string, unknown>): Promise<ContactRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<ContactRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ContactRow>;
  };
  contactInteraction: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  optOutRegistry: {
    upsert(args: { where: unknown; update: Record<string, unknown>; create: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface ImportBatchRow {
  id: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  cursor: number;
  total_rows: number;
  imported_count: number;
  merged_count: number;
  minor_flagged_count: number;
  error_rows: unknown;
  source: string;
}

export interface ContactRow {
  id: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  industry: string | null;
  is_minor_flag: boolean;
  /** T-29R2 — see `RawContactImportRow.jurisdiction`'s doc comment; read here so a cross-source
   *  merge (below) can fill it in ONLY when the existing row doesn't already have one, same as
   *  every other mergeable field on this row. */
  jurisdiction: string | null;
}

type RowOutcome = { kind: 'created' | 'merged'; isMinor: boolean };

export class VaultService {
  constructor(
    private prisma: VaultPrismaClient = new PrismaClient() as unknown as VaultPrismaClient,
    private encryptionKey: string = getContactEncryptionKey()
  ) {}

  /**
   * §7.1 "Web gets CSV + Google Contacts (native import is native-only)": refuses IOS_NATIVE/
   * ANDROID_NATIVE unless the caller declares the matching native shell. Throws — never silently
   * downgrades to a different modality — so the client surfaces the real fallback UX itself (§7.6
   * "denial gets a graceful CSV/manual path").
   */
  assertModalityAllowed(source: ContactSource, clientPlatform?: ClientPlatform): void {
    if (!NATIVE_SHELL_ONLY_SOURCES.includes(source)) return;
    const expected = source === ContactSource.IOS_NATIVE ? 'ios' : 'android';
    if (clientPlatform !== expected) {
      throw new ModalityNotAllowedError(
        `${source} contact import is only available from the native app shell (§7.1) — got ` +
          `clientPlatform=${clientPlatform ?? '(none)'}. Web callers must use CSV or Google Contacts.`
      );
    }
  }

  /**
   * The single entry point for all four ingestion modalities (§7.1). Resumable + idempotent (§18.5):
   *   - Same (userId, idempotencyKey) against an already-`COMPLETED` batch → returns the cached
   *     result verbatim; NOTHING is reprocessed (`idempotentReplay: true`).
   *   - Same (userId, idempotencyKey) against an `IN_PROGRESS` batch → resumes from `cursor`,
   *     skipping every row already committed.
   *   - No existing batch → starts a new one at cursor 0.
   * A per-row VALIDATION failure (e.g. missing name) is terminal for that row only — recorded into
   * `errorRows`, cursor advances past it, the loop continues (§7.6 downloadable error rows). A
   * per-row INFRA failure (anything else `contact.create`/`.update` throws) stops the loop at that
   * exact row WITHOUT advancing the cursor — the batch persists as `IN_PROGRESS` at that index, so a
   * retry with the same idempotencyKey resumes and retries exactly that row, never skipping it and
   * never re-creating the rows before it (§18.5 "partial failure leaves a resumable state, not
   * corruption").
   */
  async importBatch(
    userId: string,
    source: ContactSource,
    rowsInput: RawContactImportRow[] | undefined,
    opts: ImportBatchOptions
  ): Promise<ImportBatchResult> {
    this.assertModalityAllowed(source, opts.clientPlatform);

    let rows: RawContactImportRow[];
    let parseErrorRows: ImportBatchErrorRow[] = [];

    if (source === ContactSource.CSV && typeof opts.csvText === 'string') {
      const parsed = parseContactCsv(opts.csvText);
      rows = parsed.rows;
      parseErrorRows = parsed.errorRows;
    } else {
      rows = rowsInput ?? [];
      if (rows.length > MAX_IMPORT_ROWS) {
        throw new ImportLimitExceededError(
          `Import has ${rows.length} contact rows, exceeding the ${MAX_IMPORT_ROWS}-contact limit (§7.1).`
        );
      }
    }

    let batch = await this.prisma.importBatch.findUnique({
      where: { user_id_idempotency_key: { user_id: userId, idempotency_key: opts.idempotencyKey } },
    });

    if (batch && batch.status === 'COMPLETED') {
      return this.toResult(batch, true);
    }

    if (!batch) {
      batch = await this.prisma.importBatch.create({
        data: {
          user_id: userId,
          source,
          idempotency_key: opts.idempotencyKey,
          status: 'IN_PROGRESS',
          total_rows: rows.length,
          cursor: 0,
          imported_count: 0,
          merged_count: 0,
          minor_flagged_count: 0,
          error_rows: parseErrorRows.length > 0 ? parseErrorRows : undefined,
        },
      });
    }

    const errorRows: ImportBatchErrorRow[] = Array.isArray(batch.error_rows)
      ? [...(batch.error_rows as ImportBatchErrorRow[])]
      : [...parseErrorRows];

    let importedCount = batch.imported_count;
    let mergedCount = batch.merged_count;
    let minorFlaggedCount = batch.minor_flagged_count;
    let cursor = batch.cursor;
    let hardStop = false;

    for (let i = cursor; i < rows.length; i++) {
      const row = rows[i];
      try {
        const outcome = await this.upsertRow(userId, source, row, batch.id);
        if (outcome.kind === 'created') importedCount++;
        else mergedCount++;
        if (outcome.isMinor) minorFlaggedCount++;
        cursor = i + 1;
      } catch (err) {
        if (err instanceof RowValidationError) {
          errorRows.push({ index: i, reason: err.message });
          cursor = i + 1; // terminal for this row only — keep going
          continue;
        }
        // Infra failure: stop here WITHOUT advancing the cursor — resumable at exactly this row.
        hardStop = true;
        break;
      }
    }

    const status: 'IN_PROGRESS' | 'COMPLETED' = !hardStop && cursor >= rows.length ? 'COMPLETED' : 'IN_PROGRESS';

    batch = await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status,
        cursor,
        total_rows: rows.length,
        imported_count: importedCount,
        merged_count: mergedCount,
        minor_flagged_count: minorFlaggedCount,
        error_rows: errorRows.length > 0 ? errorRows : undefined,
        completed_at: status === 'COMPLETED' ? new Date() : null,
      },
    });

    return this.toResult(batch, false);
  }

  /** Upserts exactly one normalized row: encrypt, hash, dedupe-and-merge-or-create, minors-gate. */
  private async upsertRow(
    userId: string,
    source: ContactSource,
    row: RawContactImportRow,
    batchId: string
  ): Promise<RowOutcome> {
    if (!row || !row.name || !row.name.trim()) {
      throw new RowValidationError('Missing required "name" field');
    }

    const normalizedPhone = row.phone ? row.phone.replace(/\D/g, '') || null : null;
    const normalizedEmail = row.email ? row.email.toLowerCase().trim() || null : null;
    const phoneHash = normalizedPhone ? hmacForMatch(normalizedPhone) : null;
    const emailHash = normalizedEmail ? hmacForMatch(normalizedEmail) : null;
    const minor = isMinorRow(row);
    // T-29R2: the CSV/native-import capture path for `Contact.jurisdiction` — normalized (uppercase,
    // trimmed 2-letter code) via the SAME `normalizeJurisdiction` eligibility.ts's own compliance
    // check compares against, so a stray-case/whitespace difference here can never cause a false
    // non-match downstream. Absent/unmapped -> null, never fails the row.
    const normalizedJurisdiction = normalizeJurisdiction(row.jurisdiction);

    const { firstName, lastName } = splitName(row.name);

    const existing =
      phoneHash || emailHash
        ? await this.prisma.contact.findFirst({
            where: {
              user_id: userId,
              OR: [
                ...(phoneHash ? [{ phone_hash: phoneHash }] : []),
                ...(emailHash ? [{ email_hash: emailHash }] : []),
              ],
            },
          })
        : null;

    if (existing) {
      // §7.6 "Cross-source duplicate (same phone in CSV + iOS) → merge, keep most complete, log
      // overlap": fill only currently-empty fields on the existing row; never overwrite data the
      // rep already has.
      const mergeData: Record<string, unknown> = {};
      if (!existing.phone && normalizedPhone) {
        mergeData.phone = encryptOptionalField(normalizedPhone, this.encryptionKey);
        mergeData.phone_hash = phoneHash;
      }
      if (!existing.email && normalizedEmail) {
        mergeData.email = encryptOptionalField(normalizedEmail, this.encryptionKey);
        mergeData.email_hash = emailHash;
      }
      if (!existing.notes && row.notes) {
        mergeData.notes = encryptOptionalField(row.notes, this.encryptionKey);
      }
      if (!existing.industry && row.industry) {
        mergeData.industry = row.industry;
      }
      if (!existing.jurisdiction && normalizedJurisdiction) {
        mergeData.jurisdiction = normalizedJurisdiction;
      }
      if (minor && !existing.is_minor_flag) {
        mergeData.is_minor_flag = true;
        mergeData.do_not_contact = true;
        mergeData.pipeline_stage = PipelineStage.DO_NOT_CONTACT;
      }

      if (Object.keys(mergeData).length > 0) {
        await this.prisma.contact.update({ where: { id: existing.id }, data: mergeData });
      }
      // "log overlap" — an audit-visible ContactInteraction note, never a silent merge.
      await this.prisma.contactInteraction.create({
        data: {
          contact_id: existing.id,
          type: 'NOTE',
          notes: `Cross-source duplicate merged from ${source} import (batch ${batchId}).`,
        },
      });

      if (minor) {
        await this.registerMinorOptOut(phoneHash, emailHash);
      }
      return { kind: 'merged', isMinor: minor };
    }

    await this.prisma.contact.create({
      data: {
        user_id: userId,
        first_name: encryptRequiredField(firstName, this.encryptionKey),
        last_name: encryptRequiredField(lastName, this.encryptionKey),
        phone: encryptOptionalField(normalizedPhone, this.encryptionKey),
        email: encryptOptionalField(normalizedEmail, this.encryptionKey),
        phone_hash: phoneHash,
        email_hash: emailHash,
        notes: encryptOptionalField(row.notes ?? null, this.encryptionKey),
        industry: row.industry ?? null,
        jurisdiction: normalizedJurisdiction,
        source,
        import_batch_id: batchId,
        is_minor_flag: minor,
        do_not_contact: minor,
        pipeline_stage: minor ? PipelineStage.DO_NOT_CONTACT : PipelineStage.IDENTIFIED,
        segment_score: 0,
      },
    });

    if (minor) {
      await this.registerMinorOptOut(phoneHash, emailHash);
    }
    return { kind: 'created', isMinor: minor };
  }

  /**
   * §7.6 "recorded in OptOutRegistry with reason minor": registers every hashed identifier the
   * contact has against the channels an outbound send could actually use, so the SAME global
   * opt-out check every WP05 send path is required to run before dispatch (§3.4 "opt-out
   * precedence") also blocks a minor — belt-and-suspenders alongside the Contact-level
   * `do_not_contact` flag set in `upsertRow`.
   */
  private async registerMinorOptOut(phoneHash: string | null, emailHash: string | null): Promise<void> {
    const entries: { identifier_hash: string; channel: MessageChannel }[] = [];
    if (phoneHash) {
      entries.push({ identifier_hash: phoneHash, channel: MessageChannel.SMS_HANDOFF });
      entries.push({ identifier_hash: phoneHash, channel: MessageChannel.SMS_PLATFORM });
    }
    if (emailHash) {
      entries.push({ identifier_hash: emailHash, channel: MessageChannel.EMAIL });
    }
    for (const entry of entries) {
      await this.prisma.optOutRegistry.upsert({
        where: { identifier_hash_channel: { identifier_hash: entry.identifier_hash, channel: entry.channel } },
        update: {},
        create: { identifier_hash: entry.identifier_hash, channel: entry.channel, reason: 'minor' },
      });
    }
  }

  private toResult(batch: ImportBatchRow, idempotentReplay: boolean): ImportBatchResult {
    return {
      batchId: batch.id,
      source: batch.source,
      status: batch.status,
      totalRows: batch.total_rows,
      cursor: batch.cursor,
      importedCount: batch.imported_count,
      mergedCount: batch.merged_count,
      minorFlaggedCount: batch.minor_flagged_count,
      errorRows: Array.isArray(batch.error_rows) ? (batch.error_rows as ImportBatchErrorRow[]) : [],
      resumable: batch.status === 'IN_PROGRESS',
      idempotentReplay,
    };
  }
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || fullName;
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}
