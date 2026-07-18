// Repository interface + in-memory implementation for LicensingRecordData.
// Design matches the Prisma LicensingRecord model (prisma/schema.prisma) for a future DB swap —
// the same pattern src/services/compliance/audit/audit-service.ts uses for AuditEntry.

import { LicensingRecordData } from '../../../types/licensing';

export interface LicensingRepository {
  get(userId: string, jurisdiction: string): Promise<LicensingRecordData | null>;
  getAllForUser(userId: string): Promise<LicensingRecordData[]>;
  upsert(record: LicensingRecordData): Promise<void>;
}

/** In-memory repository for tests and for callers not yet wired to a live database. */
export class InMemoryLicensingRepository implements LicensingRepository {
  private records: Map<string, LicensingRecordData> = new Map();

  private key(userId: string, jurisdiction: string): string {
    return `${userId}::${jurisdiction}`;
  }

  async get(userId: string, jurisdiction: string): Promise<LicensingRecordData | null> {
    return this.records.get(this.key(userId, jurisdiction)) ?? null;
  }

  async getAllForUser(userId: string): Promise<LicensingRecordData[]> {
    return Array.from(this.records.values()).filter((r) => r.user_id === userId);
  }

  async upsert(record: LicensingRecordData): Promise<void> {
    this.records.set(this.key(record.user_id, record.jurisdiction), { ...record });
  }

  /** Test helper: all records across all users. */
  all(): LicensingRecordData[] {
    return Array.from(this.records.values());
  }

  /** Test helper: reset. */
  clear(): void {
    this.records.clear();
  }
}

// ─── T-29R (WP03 gate remediation, §8.2 "Excluded: state-unlicensed") ─────────────────────────────
// This module's header comment above documented "a future DB swap" against the Prisma
// `LicensingRecord` model (prisma/schema.prisma) as the intended production path; until this build
// unit, only `InMemoryLicensingRepository` existed, so nothing outside a test could ever construct a
// real `LicensingService`. `PrioritizedQueueService` (WP03) now needs
// `LicensingService.getLicensedJurisdictions()` for real at runtime (the exact consumer named in
// this module's own index.ts doc comment), so this is the Prisma-backed repository that makes that
// possible — mirroring `PrismaAuditRepository`'s exact shape/conventions
// (src/services/compliance/audit/audit-service.ts): a narrow delegate interface (not the full
// PrismaClient type), Date<->ISO-string mapping at the boundary, no logic beyond that mapping.

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isoOfNullable(value: Date | string | null): string | null {
  return value === null ? null : isoOf(value);
}

/** Prisma's generated shape for one `LicensingRecord` row (Dates, not the ISO strings
 *  `LicensingRecordData` uses). */
export interface LicensingRecordPrismaRow {
  id: string;
  user_id: string;
  jurisdiction: string;
  state: string;
  license_number: string | null;
  issued_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** Narrow delegate surface this repository needs — matches `prisma.licensingRecord`'s shape for the
 *  three operations `LicensingRepository` declares, keyed on the same `user_id_jurisdiction`
 *  compound-unique convention already used by `ContactMethodProfile`'s `user_id_contact_id`
 *  (src/services/harvest-method/method-state.service.ts) for the identical `@@unique([user_id,
 *  jurisdiction])` shape (prisma/schema.prisma's `LicensingRecord` model). */
export interface LicensingRecordPrismaDelegate {
  findUnique(args: {
    where: { user_id_jurisdiction: { user_id: string; jurisdiction: string } };
  }): Promise<LicensingRecordPrismaRow | null>;
  findMany(args: { where: { user_id: string } }): Promise<LicensingRecordPrismaRow[]>;
  upsert(args: {
    where: { user_id_jurisdiction: { user_id: string; jurisdiction: string } };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<LicensingRecordPrismaRow>;
}

function fromPrismaRow(row: LicensingRecordPrismaRow): LicensingRecordData {
  return {
    id: row.id,
    user_id: row.user_id,
    jurisdiction: row.jurisdiction,
    state: row.state as LicensingRecordData['state'],
    license_number: row.license_number,
    issued_at: isoOfNullable(row.issued_at),
    expires_at: isoOfNullable(row.expires_at),
    created_at: isoOf(row.created_at),
    updated_at: isoOf(row.updated_at),
  };
}

/** Prisma-backed repository — the production path, against the `LicensingRecord` model. Every
 *  method is a thin mapping over the narrow `LicensingRecordPrismaDelegate`; the actual fail-closed
 *  "no record = UNLICENSED" doctrine and all transition legality live in `LicensingService` /
 *  `licensing-state-machine.ts`, never duplicated here. */
export class PrismaLicensingRepository implements LicensingRepository {
  constructor(private prisma: { licensingRecord: LicensingRecordPrismaDelegate }) {}

  async get(userId: string, jurisdiction: string): Promise<LicensingRecordData | null> {
    const row = await this.prisma.licensingRecord.findUnique({
      where: { user_id_jurisdiction: { user_id: userId, jurisdiction } },
    });
    return row ? fromPrismaRow(row) : null;
  }

  async getAllForUser(userId: string): Promise<LicensingRecordData[]> {
    const rows = await this.prisma.licensingRecord.findMany({ where: { user_id: userId } });
    return rows.map(fromPrismaRow);
  }

  async upsert(record: LicensingRecordData): Promise<void> {
    await this.prisma.licensingRecord.upsert({
      where: { user_id_jurisdiction: { user_id: record.user_id, jurisdiction: record.jurisdiction } },
      create: {
        id: record.id,
        user_id: record.user_id,
        jurisdiction: record.jurisdiction,
        state: record.state,
        license_number: record.license_number,
        issued_at: record.issued_at,
        expires_at: record.expires_at,
      },
      update: {
        state: record.state,
        license_number: record.license_number,
        issued_at: record.issued_at,
        expires_at: record.expires_at,
      },
    });
  }
}
