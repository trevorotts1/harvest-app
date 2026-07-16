import { IncidentEventRecord } from '../../../types/incident';

/**
 * Append-only repository contract for the dedicated incident event log (build-brief item 4 —
 * "a dedicated append-only incident log"). No `update`/`delete` method exists here — that omission
 * IS the immutability enforcement, mirroring `src/services/compliance/audit/audit-service.ts`'s
 * `AuditRepository` and `src/services/security/security-event.ts`'s `SecurityEventSink`: do not
 * add one; a durable incident trail with a mutation API is exactly the "mutable audit trail"
 * failure class the WP11 QC checklist calls a critical failure.
 */
export interface IncidentRepository {
  append(event: IncidentEventRecord): Promise<void>;
  /** All events for one incident, ordered ascending by `sequence`. */
  getEvents(incidentId: string): Promise<IncidentEventRecord[]>;
  /** Every incident id that has ever had at least one event appended. */
  listIncidentIds(): Promise<string[]>;
  /** Every event across every incident, ordered ascending by `occurred_at` — the read side used by
   *  the fail-safe watchlist queries (they must scan every incident, not just one). */
  allEvents(): Promise<IncidentEventRecord[]>;
}

/** In-memory repository — used by tests and as the default store until a Prisma-backed repository
 *  is wired in against the `IncidentEvent` table (see prisma/schema.prisma). */
export class InMemoryIncidentRepository implements IncidentRepository {
  private events: IncidentEventRecord[] = [];
  private ids: Set<string> = new Set();

  async append(event: IncidentEventRecord): Promise<void> {
    if (this.ids.has(event.id)) {
      // Append-only means append-only: reusing an id to overwrite an existing row is exactly the
      // "mutable audit trail" failure mode, so this throws rather than upserting.
      throw new Error(
        `IncidentRepository.append: an event with id '${event.id}' already exists — incident events are append-only and cannot be overwritten`
      );
    }
    this.ids.add(event.id);
    this.events.push(Object.freeze({ ...event }));
  }

  async getEvents(incidentId: string): Promise<IncidentEventRecord[]> {
    return this.events
      .filter((e) => e.incident_id === incidentId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async listIncidentIds(): Promise<string[]> {
    return [...new Set(this.events.map((e) => e.incident_id))];
  }

  async allEvents(): Promise<IncidentEventRecord[]> {
    return [...this.events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }

  // ── Test-only helpers. Deliberately NOT part of `IncidentRepository` — a caller typed against
  // the interface cannot reach these. Neither mutates or removes an individual row; `clear()`
  // wipes the entire in-memory store (a fixture reset), not a per-row delete API. ───────────────

  /** Test helper: count events across every incident. */
  count(): number {
    return this.events.length;
  }

  /** Test helper: reset the entire in-memory store (not a per-row delete). */
  clear(): void {
    this.events = [];
    this.ids.clear();
  }
}

/** Minimal shape of the Prisma `incidentEvent` delegate this repository needs — kept narrow so a
 *  plain mock object satisfies it in tests without pulling in a real PrismaClient/DATABASE_URL,
 *  mirroring `AuditEntryPrismaDelegate`/`LegalHoldPrismaDelegate`'s convention. */
export interface IncidentEventPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }): Promise<unknown[]>;
}

interface IncidentEventRow {
  id: string;
  incident_id: string;
  sequence: number;
  kind: string;
  actor_id: string | null;
  actor_role: string | null;
  occurred_at: Date | string;
  payload: Record<string, unknown>;
}

function fromPrismaRow(row: IncidentEventRow): IncidentEventRecord {
  return {
    id: row.id,
    incident_id: row.incident_id,
    sequence: row.sequence,
    kind: row.kind as IncidentEventRecord['kind'],
    actor_id: row.actor_id ?? null,
    actor_role: (row.actor_role as IncidentEventRecord['actor_role']) ?? null,
    occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
    payload: row.payload ?? {},
  };
}

/**
 * Prisma-backed repository — the production path, against the additive `IncidentEvent` model (see
 * prisma/schema.prisma). No `update`/`delete` method exists here either; a row with a duplicate id
 * is rejected by the table's own primary-key constraint, which is `append()`'s enforcement
 * mechanism at this layer (the in-memory repository checks explicitly since a plain array has no
 * such constraint of its own) — the identical posture `PrismaAuditRepository` already documents.
 */
export class PrismaIncidentRepository implements IncidentRepository {
  constructor(private readonly prisma: { incidentEvent: IncidentEventPrismaDelegate }) {}

  async append(event: IncidentEventRecord): Promise<void> {
    await this.prisma.incidentEvent.create({
      data: {
        id: event.id,
        incident_id: event.incident_id,
        sequence: event.sequence,
        kind: event.kind,
        actor_id: event.actor_id,
        actor_role: event.actor_role,
        payload: event.payload,
        occurred_at: event.occurred_at,
      },
    });
  }

  async getEvents(incidentId: string): Promise<IncidentEventRecord[]> {
    const rows = (await this.prisma.incidentEvent.findMany({
      where: { incident_id: incidentId },
      orderBy: { sequence: 'asc' },
    })) as IncidentEventRow[];
    return rows.map(fromPrismaRow);
  }

  async listIncidentIds(): Promise<string[]> {
    const rows = (await this.prisma.incidentEvent.findMany({
      where: { sequence: 1 },
      orderBy: { occurred_at: 'asc' },
    })) as IncidentEventRow[];
    return rows.map((r) => r.incident_id);
  }

  async allEvents(): Promise<IncidentEventRecord[]> {
    const rows = (await this.prisma.incidentEvent.findMany({
      orderBy: { occurred_at: 'asc' },
    })) as IncidentEventRow[];
    return rows.map(fromPrismaRow);
  }
}
