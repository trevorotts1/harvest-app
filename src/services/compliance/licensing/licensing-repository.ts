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
