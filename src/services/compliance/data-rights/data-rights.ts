import { randomUUID } from 'crypto';
import {
  DATA_EXPORT_SLA_MINUTES,
  DeletionCertificate,
  ExportFormat,
  RetainedRecordRef,
  UserDataDeletionRecord,
  UserDataExportRecord,
} from '../../../types/data-rights';
import { LegalHoldService } from './legal-hold';
import { DataRightsAuditSink, buildDataRightsAuditEvent } from './audit-emit';

/**
 * Data Rights service for T-11 (master-spec §16.3).
 *
 * Implements GDPR/CCPA export + deletion, wired to the Prisma `UserDataDeletion` /
 * `UserDataExport` models introduced in T-03. The crux of this file is `processDeletion`:
 *
 *   1. If an ACTIVE LegalHold exists on the user, the deletion is BLOCKED — recorded as HELD,
 *      and NOTHING is touched (no PII scrub happens). See §16.3 "GDPR/CCPA deletion vs. FINRA
 *      retention" and §3.4 "Deletion cascade with legal hold".
 *   2. Otherwise, ordinary PII on `User` and the user's `Contact` rows is deleted/anonymized —
 *      but FINRA 2210/3110-required communications (`AuditEntry` rows tagged `regulation:
 *      'FINRA'`) are never touched. They are only *read* (to list them in the certificate), never
 *      deleted or updated. That is the legal-hold carve-out (§16.2, §16.3, §3.4).
 *   3. A `DeletionCertificate` documents exactly what was deleted vs. retained and why, and its
 *      URL is written to `UserDataDeletion.deletion_certificate_url`.
 *
 * This module deliberately does not import from ../classifiers, ../engine, or ../safe-harbor
 * (owned by the concurrent CFE build, T-08) — the only compliance-owned import is
 * `../rbac/rbac-service` (via LegalHoldService), which is a pre-existing, uncontested dependency.
 */

// ─────────────────────────────────────────────────────────────────────────
// Narrow Prisma delegate shapes — enough surface for this service, easy to satisfy with a plain
// mock object in tests (see tests/unit/data-rights.test.ts), matching the constructor-injection
// pattern already used by src/services/warm-market/contact.service.ts.
// ─────────────────────────────────────────────────────────────────────────

export interface DataRightsPrismaClient {
  user: {
    findUnique(args: { where: { id: string } }): Promise<UserRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UserRow>;
  };
  contact: {
    findMany(args: { where: Record<string, unknown> }): Promise<ContactRow[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  auditEntry: {
    findMany(args: { where: Record<string, unknown> }): Promise<AuditEntryRow[]>;
  };
  userDataDeletion: {
    create(args: { data: Record<string, unknown> }): Promise<UserDataDeletionRow>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<UserDataDeletionRow>;
    findUnique(args: { where: { id: string } }): Promise<UserDataDeletionRow | null>;
  };
  userDataExport: {
    create(args: { data: Record<string, unknown> }): Promise<UserDataExportRow>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<UserDataExportRow>;
    findUnique(args: { where: { id: string } }): Promise<UserDataExportRow | null>;
  };
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  solution_number?: string | null;
  anchor_statement?: string | null;
  calendar_preferences?: unknown;
  mfa_methods?: unknown;
  [key: string]: unknown;
}

interface ContactRow {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  phone_hash?: string | null;
  email_hash?: string | null;
  [key: string]: unknown;
}

interface AuditEntryRow {
  id: string;
  user_id: string;
  regulation: string;
  content_hash: string;
  created_at: Date | string;
}

interface UserDataDeletionRow {
  id: string;
  user_id: string;
  status: string;
  anonymized_fields: string[];
  retained_fields: string[];
  deletion_certificate_url: string | null;
  requested_at: Date | string;
  completed_at: Date | string | null;
}

interface UserDataExportRow {
  id: string;
  user_id: string;
  status: string;
  expires_at: Date | string;
  created_at: Date | string;
}

// The FINRA carve-out regulation tag as written by the CFE audit path (src/types/compliance.ts's
// `Regulation` union includes 'FINRA'). Kept as a local constant (not re-exported from the CFE's
// types module) so this file has no import dependency on anything the CFE build owns.
const FINRA_REGULATION_TAG = 'FINRA';

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDeletionRecord(row: UserDataDeletionRow): UserDataDeletionRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status as UserDataDeletionRecord['status'],
    anonymized_fields: row.anonymized_fields ?? [],
    retained_fields: row.retained_fields ?? [],
    deletion_certificate_url: row.deletion_certificate_url ?? null,
    requested_at: isoOf(row.requested_at),
    completed_at: row.completed_at ? isoOf(row.completed_at) : null,
  };
}

function toExportRecord(row: UserDataExportRow): UserDataExportRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status as UserDataExportRecord['status'],
    expires_at: isoOf(row.expires_at),
    created_at: isoOf(row.created_at),
  };
}

export class DataRightsService {
  constructor(
    private prisma: DataRightsPrismaClient,
    private legalHold: LegalHoldService,
    private auditSink?: DataRightsAuditSink
  ) {}

  // ── Deletion ────────────────────────────────────────────────────────────

  /** Create a deletion request. Does not perform the deletion itself — see `processDeletion`. */
  async requestDeletion(input: { user_id: string; requested_by: string }): Promise<UserDataDeletionRecord> {
    const row = await this.prisma.userDataDeletion.create({
      data: {
        id: randomUUID(),
        user_id: input.user_id,
        status: 'PENDING',
        anonymized_fields: [],
        retained_fields: [],
        requested_at: new Date(),
      },
    });

    await this.auditSink?.record(
      buildDataRightsAuditEvent('deletion.requested', input.user_id, input.requested_by, {
        deletion_id: row.id,
      })
    );

    return toDeletionRecord(row);
  }

  /**
   * Process a deletion request. THE CRUX: checks for an active legal hold first, and either
   * blocks (HELD) or proceeds with a PII scrub that preserves the FINRA carve-out set.
   */
  async processDeletion(
    deletion_id: string,
    actor_id: string
  ): Promise<{ record: UserDataDeletionRecord; certificate: DeletionCertificate }> {
    const existing = await this.prisma.userDataDeletion.findUnique({ where: { id: deletion_id } });
    if (!existing) {
      throw new Error(`UserDataDeletion ${deletion_id} not found`);
    }
    const user_id = existing.user_id;
    const requestedAt = isoOf(existing.requested_at);

    // §16.3 / §3.4: an active legal hold blocks deletion outright — nothing below this point may
    // run if a hold is in force.
    const hold = await this.legalHold.isUnderHold(user_id);
    if (hold) {
      const heldRow = await this.prisma.userDataDeletion.update({
        where: { id: deletion_id },
        data: { status: 'HELD' },
      });

      await this.auditSink?.record(
        buildDataRightsAuditEvent('deletion.held', user_id, actor_id, {
          deletion_id,
          hold_id: hold.id,
          reason: hold.reason,
        })
      );

      const certificate: DeletionCertificate = {
        user_id,
        deletion_id,
        requested_at: requestedAt,
        completed_at: null,
        status: 'HELD',
        deleted_fields: [],
        retained_records: [],
        legal_hold: { hold_id: hold.id, reason: hold.reason, placed_at: hold.placed_at },
        cascade_hashes: [],
        certificate_url: this.certificateUrl(deletion_id),
      };

      return { record: toDeletionRecord(heldRow), certificate };
    }

    const user = await this.prisma.user.findUnique({ where: { id: user_id } });
    if (!user) {
      throw new Error(`User ${user_id} not found`);
    }

    // Ordinary PII: deleted/anonymized on User.
    await this.prisma.user.update({
      where: { id: user_id },
      data: {
        email: `deleted-${user_id}@anonymized.harvest.app`,
        name: 'Deleted User',
        phone: null,
        solution_number: null,
        anchor_statement: null,
        calendar_preferences: null,
        mfa_methods: null,
      },
    });
    const deletedFields = [
      'User.email',
      'User.name',
      'User.phone',
      'User.solution_number',
      'User.anchor_statement',
      'User.calendar_preferences',
      'User.mfa_methods',
    ];

    // Ordinary PII: deleted/anonymized on the user's own Contact rows (the Vault records they own).
    const contacts = await this.prisma.contact.findMany({ where: { user_id } });
    const cascadeHashes = contacts.map((c) => ({
      contact_id: c.id,
      phone_hash: c.phone_hash ?? null,
      email_hash: c.email_hash ?? null,
    }));
    if (contacts.length > 0) {
      await this.prisma.contact.updateMany({
        where: { user_id },
        data: {
          first_name: 'Deleted',
          last_name: '',
          phone: null,
          email: null,
          notes: null,
          phone_hash: null,
          email_hash: null,
        },
      });
      deletedFields.push(
        'Contact.first_name',
        'Contact.last_name',
        'Contact.phone',
        'Contact.email',
        'Contact.notes'
      );
    }

    // THE CARVE-OUT: read (never write/delete) the FINRA-tagged compliance/communications audit
    // trail for this user. These rows survive the deletion untouched.
    const regulated = await this.prisma.auditEntry.findMany({
      where: { user_id, regulation: FINRA_REGULATION_TAG },
    });
    const retainedRecords: RetainedRecordRef[] = regulated.map((r) => ({
      ref: `AuditEntry:${r.id}`,
      reason: 'FINRA 2210/3110 — 7yr communications retention, segregated archive (§16.2, §16.3)',
    }));

    const completedAt = new Date();
    const certificateUrl = this.certificateUrl(deletion_id);

    const updatedRow = await this.prisma.userDataDeletion.update({
      where: { id: deletion_id },
      data: {
        status: 'COMPLETED',
        anonymized_fields: deletedFields,
        retained_fields: retainedRecords.map((r) => r.ref),
        deletion_certificate_url: certificateUrl,
        completed_at: completedAt,
      },
    });

    await this.auditSink?.record(
      buildDataRightsAuditEvent('deletion.completed', user_id, actor_id, {
        deletion_id,
        deleted_field_count: deletedFields.length,
        retained_record_count: retainedRecords.length,
      })
    );

    const certificate: DeletionCertificate = {
      user_id,
      deletion_id,
      requested_at: requestedAt,
      completed_at: completedAt.toISOString(),
      status: 'COMPLETED',
      deleted_fields: deletedFields,
      retained_records: retainedRecords,
      cascade_hashes: cascadeHashes,
      certificate_url: certificateUrl,
    };

    return { record: toDeletionRecord(updatedRow), certificate };
  }

  private certificateUrl(deletion_id: string): string {
    return `https://api.harvest.app/data-rights/deletion-certificates/${deletion_id}`;
  }

  // ── Export ──────────────────────────────────────────────────────────────

  async requestExport(input: { user_id: string }): Promise<UserDataExportRecord> {
    const now = new Date();
    const row = await this.prisma.userDataExport.create({
      data: {
        id: randomUUID(),
        user_id: input.user_id,
        status: 'PENDING',
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        created_at: now,
      },
    });

    await this.auditSink?.record(
      buildDataRightsAuditEvent('export.requested', input.user_id, input.user_id, {
        export_id: row.id,
      })
    );

    return toExportRecord(row);
  }

  /**
   * Generate the export payload and mark the request COMPLETED. Per §16.8-3, must produce valid
   * JSON/CSV within DATA_EXPORT_SLA_MINUTES (5 minutes) — this in-process implementation completes
   * synchronously, well inside the SLA; `sla_deadline` is returned so a caller can assert on it.
   */
  async processExport(
    export_id: string,
    format: ExportFormat
  ): Promise<{ record: UserDataExportRecord; payload: string; sla_deadline: string }> {
    const existing = await this.prisma.userDataExport.findUnique({ where: { id: export_id } });
    if (!existing) {
      throw new Error(`UserDataExport ${export_id} not found`);
    }

    const user = await this.prisma.user.findUnique({ where: { id: existing.user_id } });
    if (!user) {
      throw new Error(`User ${existing.user_id} not found`);
    }
    const contacts = await this.prisma.contact.findMany({ where: { user_id: existing.user_id } });

    const exportObject = { user, contacts };
    const payload =
      format === 'json' ? JSON.stringify(exportObject, null, 2) : toCsv(exportObject);

    const now = new Date();
    const updatedRow = await this.prisma.userDataExport.update({
      where: { id: export_id },
      data: { status: 'COMPLETED', expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
    });

    await this.auditSink?.record(
      buildDataRightsAuditEvent('export.completed', existing.user_id, existing.user_id, {
        export_id,
        format,
      })
    );

    const slaDeadline = new Date(
      new Date(isoOf(existing.created_at)).getTime() + DATA_EXPORT_SLA_MINUTES * 60 * 1000
    ).toISOString();

    return { record: toExportRecord(updatedRow), payload, sla_deadline: slaDeadline };
  }
}

/**
 * RFC 4180 field escaping: wrap every field in double quotes and double any embedded double
 * quote (the CSV standard's escape convention — NOT backslash-escaping, which is not valid CSV
 * and would misparse under a real CSV reader once a field contains embedded commas/quotes, as
 * any nested-JSON field here will).
 */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Flat, dependency-free CSV serializer — good enough for a self-contained data export. */
function toCsv(obj: Record<string, unknown>): string {
  const flat: Record<string, string> = {};
  const walk = (value: unknown, prefix: string) => {
    if (value === null || value === undefined) {
      flat[prefix] = '';
    } else if (Array.isArray(value)) {
      // Arrays (e.g. the user's list of Contact records) have no native CSV representation —
      // serialized as a single JSON-string field. RFC 4180 quoting (above) makes embedding a
      // JSON blob in one field both valid and round-trippable.
      flat[prefix] = JSON.stringify(value);
    } else if (typeof value === 'object') {
      // Plain nested objects are flattened key-by-key (dot-notation) rather than blobbed, so a
      // scalar field like user.email stays its own column.
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, prefix ? `${prefix}.${k}` : k);
      }
    } else {
      flat[prefix] = String(value);
    }
  };
  walk(obj, '');

  const keys = Object.keys(flat);
  const header = keys.map((k) => csvField(k)).join(',');
  const row = keys.map((k) => csvField(flat[k])).join(',');
  return `${header}\n${row}`;
}
