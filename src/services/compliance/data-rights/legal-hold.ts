import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { LegalHoldRecord, LegalHoldStatus } from '../../../types/data-rights';
import { RBACService } from '../rbac/rbac-service';
import { DataRightsAuditSink, buildDataRightsAuditEvent } from './audit-emit';

/**
 * Legal hold (T-11, master-spec §16.3 + §3.4 "Deletion cascade with legal hold").
 *
 * When a legal hold is ACTIVE on a user, any deletion request against that user is BLOCKED
 * (recorded as HELD) until the hold is LIFTED — see data-rights.ts, which calls
 * `LegalHoldService.isUnderHold()` before touching any PII.
 */

// Minimal shape of the Prisma `legalHold` delegate this service needs — kept narrow so a plain
// mock object satisfies it in tests without pulling in the real PrismaClient.
/** Raw shape of a `LegalHold` row as returned by the Prisma delegate. */
interface PrismaLegalHoldRow {
  id: string;
  user_id: string;
  status: string;
  reason: string;
  placed_by: string;
  placed_at: string | Date;
  lifted_by?: string | null;
  lifted_at?: string | Date | null;
  note?: string | null;
}

export interface LegalHoldPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<PrismaLegalHoldRow>;
  findFirst(args: { where: Record<string, unknown> }): Promise<PrismaLegalHoldRow | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaLegalHoldRow>;
}

export interface LegalHoldRepository {
  place(input: { user_id: string; reason: string; placed_by: string; note?: string }): Promise<LegalHoldRecord>;
  findActiveForUser(user_id: string): Promise<LegalHoldRecord | null>;
  lift(hold_id: string, lifted_by: string): Promise<LegalHoldRecord>;
}

function toRecord(row: PrismaLegalHoldRow): LegalHoldRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status as LegalHoldStatus,
    reason: row.reason,
    placed_by: row.placed_by,
    placed_at: row.placed_at instanceof Date ? row.placed_at.toISOString() : row.placed_at,
    lifted_by: row.lifted_by ?? null,
    lifted_at:
      row.lifted_at instanceof Date ? row.lifted_at.toISOString() : row.lifted_at ?? null,
    note: row.note ?? null,
  };
}

/** Prisma-backed repository — production path. `prisma.legalHold` maps to the LegalHold model. */
export class PrismaLegalHoldRepository implements LegalHoldRepository {
  constructor(private prisma: { legalHold: LegalHoldPrismaDelegate }) {}

  async place(input: {
    user_id: string;
    reason: string;
    placed_by: string;
    note?: string;
  }): Promise<LegalHoldRecord> {
    const row = await this.prisma.legalHold.create({
      data: {
        id: randomUUID(),
        user_id: input.user_id,
        status: 'ACTIVE',
        reason: input.reason,
        placed_by: input.placed_by,
        placed_at: new Date(),
        note: input.note ?? null,
      },
    });
    return toRecord(row);
  }

  async findActiveForUser(user_id: string): Promise<LegalHoldRecord | null> {
    const row = await this.prisma.legalHold.findFirst({
      where: { user_id, status: 'ACTIVE' },
    });
    return row ? toRecord(row) : null;
  }

  async lift(hold_id: string, lifted_by: string): Promise<LegalHoldRecord> {
    const row = await this.prisma.legalHold.update({
      where: { id: hold_id },
      data: { status: 'LIFTED', lifted_by, lifted_at: new Date() },
    });
    return toRecord(row);
  }
}

/** In-memory repository — unit tests / local dev without a database. */
export class InMemoryLegalHoldRepository implements LegalHoldRepository {
  private holds: Map<string, LegalHoldRecord> = new Map();

  async place(input: {
    user_id: string;
    reason: string;
    placed_by: string;
    note?: string;
  }): Promise<LegalHoldRecord> {
    const record: LegalHoldRecord = {
      id: randomUUID(),
      user_id: input.user_id,
      status: 'ACTIVE',
      reason: input.reason,
      placed_by: input.placed_by,
      placed_at: new Date().toISOString(),
      lifted_by: null,
      lifted_at: null,
      note: input.note ?? null,
    };
    this.holds.set(record.id, record);
    return record;
  }

  async findActiveForUser(user_id: string): Promise<LegalHoldRecord | null> {
    for (const hold of this.holds.values()) {
      if (hold.user_id === user_id && hold.status === 'ACTIVE') return hold;
    }
    return null;
  }

  async lift(hold_id: string, lifted_by: string): Promise<LegalHoldRecord> {
    const existing = this.holds.get(hold_id);
    if (!existing) throw new Error(`LegalHold ${hold_id} not found`);
    const updated: LegalHoldRecord = {
      ...existing,
      status: 'LIFTED',
      lifted_by,
      lifted_at: new Date().toISOString(),
    };
    this.holds.set(hold_id, updated);
    return updated;
  }

  clear(): void {
    this.holds.clear();
  }
}

export class LegalHoldService {
  private rbac = new RBACService();

  constructor(
    private repository: LegalHoldRepository,
    private auditSink?: DataRightsAuditSink
  ) {}

  /**
   * Place a legal hold on a user. Only ADMIN/RVP have the 'manage' action on the 'data_rights'
   * resource (see rbac-service.ts's ROLE_PERMISSIONS) — reusing the existing RBAC matrix rather
   * than inventing a parallel authorization check.
   */
  async placeHold(input: {
    user_id: string;
    reason: string;
    placed_by: string;
    placed_by_role: Role;
    note?: string;
  }): Promise<LegalHoldRecord> {
    this.rbac.assertPermission(input.placed_by_role, 'data_rights', 'manage');

    const existing = await this.repository.findActiveForUser(input.user_id);
    if (existing) {
      // Idempotent: placing a hold on an already-held user is a no-op that returns the
      // existing hold rather than creating a duplicate ACTIVE row.
      return existing;
    }

    const record = await this.repository.place({
      user_id: input.user_id,
      reason: input.reason,
      placed_by: input.placed_by,
      note: input.note,
    });

    await this.auditSink?.record(
      buildDataRightsAuditEvent('legal_hold.placed', input.user_id, input.placed_by, {
        hold_id: record.id,
        reason: record.reason,
      })
    );

    return record;
  }

  async liftHold(input: {
    hold_id: string;
    user_id: string;
    lifted_by: string;
    lifted_by_role: Role;
  }): Promise<LegalHoldRecord> {
    this.rbac.assertPermission(input.lifted_by_role, 'data_rights', 'manage');

    const record = await this.repository.lift(input.hold_id, input.lifted_by);

    await this.auditSink?.record(
      buildDataRightsAuditEvent('legal_hold.lifted', input.user_id, input.lifted_by, {
        hold_id: record.id,
      })
    );

    return record;
  }

  /** The single question deletion processing needs answered before touching any PII. */
  async isUnderHold(user_id: string): Promise<LegalHoldRecord | null> {
    return this.repository.findActiveForUser(user_id);
  }
}
