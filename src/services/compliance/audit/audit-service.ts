import { randomUUID, createHash } from 'crypto';
import { Role } from '@prisma/client';
import {
  AuditPayload,
  Classifier,
  CFEDecision,
  Channel,
  Regulation,
  CFE_RULE_VERSION,
} from '@/types/compliance';
import {
  computeEntryHash,
  verifyChain,
  GENESIS_PREV_HASH,
  type ChainVerificationResult,
  type ChainedEntry,
} from './hash-chain';

/**
 * The immutable, append-only, hash-chained audit store for WP11 (T-10, master-spec §5.6/§5.7/
 * §16.1/§17.8). Every CFE decision (T-08), licensing state transition (T-13), data-rights event
 * (T-11), and — going forward — account-security event (T-12) funnels into this store via
 * `AuditService.recordAuditEvent`, the one `recordAuditEvent(...)` contract named in §5.7. It is
 * also the source of the rep-visible Agent Activity Ledger (`./activity-ledger.ts`) — "operator
 * observability and rep-facing transparency never diverge" (§17.8).
 *
 * Immutability, structurally enforced (§16.1 "immutability (append-only, signed audit)"):
 *   - `AuditRepository` declares `append`/`query`/`getById`/`getChainTail` and NOTHING else — there
 *     is no `update`, no `delete`, on the interface OR on `InMemoryAuditRepository`. This isn't a
 *     runtime check bolted on top of a mutable API; the mutation path simply does not exist in the
 *     type or the class.
 *   - `append()` throws if a row with the same `id` already exists — a caller cannot smuggle an
 *     "update" through the append path by reusing an id.
 *   - Every row handed back to a caller (`query`/`getById`) is `Object.freeze`'d, so even a
 *     caller who tries to mutate the object it got back throws (`TypeError` in strict/ESM mode)
 *     instead of silently succeeding.
 *
 * Tamper evidence (§5.6 "immutable, cryptographically signed"): see `./hash-chain.ts` for the
 * hash-chain design (`entry_hash` over content + `prev_hash`) and its honest limitations.
 */

export interface AuditEntryRecord {
  id: string;
  /** Monotonic append order — independent of `created_at` wall-clock time (which can collide
   *  under concurrent writers). The hash chain and its tamper-evidence proofs key off this, not
   *  timestamps. Assigned by `AuditService.recordAuditEvent`, never by the caller. */
  sequence: number;
  user_id: string;
  content_hash: string;
  risk_score: number;
  outcome: CFEDecision | 'RECORDED';
  classifier_data: Record<string, unknown>;
  role: Role;
  created_at: string;
  /** Hash-chain link to the previous row's `entry_hash` (`null` only for the very first row ever
   *  appended — the chain's genesis). */
  prev_hash: string | null;
  /** SHA-256 over this row's content + `prev_hash` (`./hash-chain.ts`). */
  entry_hash: string;
  // Extended fields beyond the base Prisma columns above (persisted as-is; a Prisma-backed
  // repository maps these onto the matching AuditEntry columns).
  content_id?: string | null;
  content_text?: string;
  classifier_scores?: Record<Classifier, number>;
  classifier_results?: unknown[];
  safe_harbor_injected?: boolean;
  safe_harbor_disclaimers?: string[];
  channel?: Channel | string | null;
  rule_version?: string;
  regulation?: Regulation[] | string;
  reviewer_id?: string | null;
  reviewer_action?: string | null;
}

export interface AuditQueryFilters {
  user_id?: string;
  /** Multi-user lookup (e.g. an upline's team-scoped Activity Ledger view). */
  user_ids?: string[];
  from?: string;
  to?: string;
}

/**
 * Append-only repository contract. No `update`/`delete` method exists here — that omission IS the
 * immutability enforcement (§16.1). Do not add one; a durable audit trail with a mutation API is a
 * QC critical-failure condition per the WP11 QC checklist ("a mutable or unsigned audit trail").
 */
export interface AuditRepository {
  append(entry: AuditEntryRecord): Promise<void>;
  query(filters: AuditQueryFilters): Promise<AuditEntryRecord[]>;
  getById(id: string): Promise<AuditEntryRecord | null>;
  /** The current chain tail (`sequence` + `entry_hash` of the most recently appended row), or
   *  `null` if the store is empty. Lets `AuditService` chain the next append without a full-table
   *  scan, and is the natural hook point for a future external checkpoint/anchoring job
   *  (`./hash-chain.ts`'s documented tail-truncation limitation). */
  getChainTail(): Promise<{ sequence: number; entry_hash: string } | null>;
}

/**
 * In-memory audit repository — used by tests and as the default store until a Prisma-backed
 * repository is wired in against the `AuditEntry` table (see `prisma/schema.prisma`, whose columns
 * this record shape mirrors 1:1 plus the additive `sequence`/`prev_hash`/`entry_hash` columns).
 */
export class InMemoryAuditRepository implements AuditRepository {
  private entries: Map<string, AuditEntryRecord> = new Map();
  private tail: { sequence: number; entry_hash: string } | null = null;

  async append(entry: AuditEntryRecord): Promise<void> {
    if (this.entries.has(entry.id)) {
      // Append-only means append-only: reusing an id to overwrite an existing row is exactly the
      // "mutable audit trail" QC critical-failure condition, so this throws rather than upserting.
      throw new Error(`AuditRepository.append: an entry with id '${entry.id}' already exists — audit rows are append-only and cannot be overwritten`);
    }
    const frozen = Object.freeze({ ...entry });
    this.entries.set(entry.id, frozen);
    this.tail = { sequence: entry.sequence, entry_hash: entry.entry_hash };
  }

  async query(filters: AuditQueryFilters): Promise<AuditEntryRecord[]> {
    let results = Array.from(this.entries.values());
    if (filters.user_id) {
      results = results.filter((e) => e.user_id === filters.user_id);
    }
    if (filters.user_ids && filters.user_ids.length > 0) {
      const set = new Set(filters.user_ids);
      results = results.filter((e) => set.has(e.user_id));
    }
    if (filters.from) {
      results = results.filter((e) => e.created_at >= filters.from!);
    }
    if (filters.to) {
      results = results.filter((e) => e.created_at <= filters.to!);
    }
    return results.sort((a, b) => a.sequence - b.sequence);
  }

  async getById(id: string): Promise<AuditEntryRecord | null> {
    return this.entries.get(id) ?? null;
  }

  async getChainTail(): Promise<{ sequence: number; entry_hash: string } | null> {
    return this.tail;
  }

  // ── Test-only helpers. Deliberately NOT part of `AuditRepository` — a caller typed against the
  // interface (which is the only thing production code should ever depend on) cannot reach these.
  // None of them mutate or remove an individual row; `clear()` wipes the entire in-memory store
  // (a full test-fixture reset, the in-memory equivalent of tearing down and recreating a test DB),
  // not a per-row delete API. ────────────────────────────────────────────────────────────────────

  /** Test helper: count entries. */
  count(): number {
    return this.entries.size;
  }

  /** Test helper: get all entries, in append order. */
  all(): AuditEntryRecord[] {
    return Array.from(this.entries.values()).sort((a, b) => a.sequence - b.sequence);
  }

  /** Test helper: reset the entire in-memory store (not a per-row delete). */
  clear(): void {
    this.entries.clear();
    this.tail = null;
  }
}

/**
 * Collapses a CFE-style `Regulation[]` (or any string array) onto the single string the
 * `AuditEntry.regulation` column holds. FINRA always wins when present: §16.3's legal-hold
 * carve-out (`DataRightsService`) filters rows with `where: { regulation: 'FINRA' }` to find every
 * row a GDPR/CCPA deletion must retain — collapsing to anything else when FINRA also applies would
 * silently drop a row out of that carve-out and let a deletion destroy a FINRA-required record.
 * This is NOT a risk-scoring "strictest regulation" choice (that's the CFE's own §5.4 multiplier
 * logic, untouched here) — it is a retention-safety choice, and FINRA retention safety outranks
 * every other regulation tag for this one column.
 */
export function deriveRegulationTag(regulations: readonly string[] | undefined): string {
  if (!regulations || regulations.length === 0) return 'NONE';
  if (regulations.includes('FINRA')) return 'FINRA';
  if (regulations.length === 1) return regulations[0];
  return regulations.join(',');
}

/** The valid `MessageChannel` enum values (prisma/schema.prisma) — used to detect whether a
 *  `channel` value already matches the DB enum or needs mapping from the CFE's looser `Channel`
 *  union (`SMS`/`EMAIL`/`SOCIAL`/`PHONE`, `src/types/compliance.ts`). */
const MESSAGE_CHANNEL_VALUES = new Set(['SMS_HANDOFF', 'SMS_PLATFORM', 'EMAIL', 'SOCIAL_DM', 'IN_APP']);

/** Best-effort map from the CFE's `Channel` union onto the schema's `MessageChannel` enum. `PHONE`
 *  has no `MessageChannel` equivalent (no voice-call channel exists in that enum) and maps to
 *  `null` — the original value is never lost, since it stays intact in `classifier_data`/
 *  `event_data`, only the strict-enum DB column falls back to null for that one case. */
const CFE_CHANNEL_TO_MESSAGE_CHANNEL: Record<string, string> = {
  SMS: 'SMS_HANDOFF',
  EMAIL: 'EMAIL',
  SOCIAL: 'SOCIAL_DM',
};

/** Maps any incoming channel value onto a valid `MessageChannel` enum string, or `null`. Safe to
 *  call with a value that's already a valid `MessageChannel` (passes through unchanged). */
export function mapChannelForPersistence(channel: string | null | undefined): string | null {
  if (!channel) return null;
  if (MESSAGE_CHANNEL_VALUES.has(channel)) return channel;
  return CFE_CHANNEL_TO_MESSAGE_CHANNEL[channel] ?? null;
}

// Minimal shape of the Prisma `auditEntry` delegate this repository needs — kept narrow (mirrors
// `LegalHoldPrismaDelegate`'s convention in `../data-rights/legal-hold.ts`) so a plain mock object
// satisfies it in tests without pulling in a real PrismaClient/DATABASE_URL.
export interface AuditEntryPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<any>;
  findMany(args: { where?: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<any[]>;
  findUnique(args: { where: { id: string } }): Promise<any | null>;
  findFirst(args: { where?: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<any | null>;
}

function fromPrismaRow(row: any): AuditEntryRecord {
  return {
    id: row.id,
    sequence: row.sequence,
    user_id: row.user_id,
    content_hash: row.content_hash,
    risk_score: row.risk_score,
    outcome: row.outcome,
    classifier_data: row.classifier_data ?? {},
    role: row.role,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    prev_hash: row.prev_hash ?? null,
    entry_hash: row.entry_hash,
    content_id: row.content_id ?? null,
    content_text: row.content_text,
    channel: row.channel ?? null,
    rule_version: row.rule_version,
    regulation: row.regulation,
    reviewer_id: row.reviewer_id ?? null,
    reviewer_action: row.reviewer_action ?? null,
  };
}

/**
 * Prisma-backed repository — the production path, against the `AuditEntry` model (see
 * prisma/schema.prisma, including this build's additive `sequence`/`prev_hash`/`entry_hash`
 * columns). No `update`/`delete` method exists here either — see the module doc above; a row with
 * a duplicate `id` is rejected by the table's own primary-key constraint, which is `append()`'s
 * enforcement mechanism at this layer (the in-memory repository checks explicitly since a Map has
 * no such constraint of its own).
 */
export class PrismaAuditRepository implements AuditRepository {
  constructor(private prisma: { auditEntry: AuditEntryPrismaDelegate }) {}

  async append(entry: AuditEntryRecord): Promise<void> {
    await this.prisma.auditEntry.create({
      data: {
        id: entry.id,
        sequence: entry.sequence,
        user_id: entry.user_id,
        content_id: entry.content_id ?? null,
        content_text: entry.content_text ?? '',
        content_hash: entry.content_hash,
        channel: mapChannelForPersistence(entry.channel as string | null | undefined),
        risk_score: entry.risk_score,
        outcome: entry.outcome,
        classifier_data: entry.classifier_data ?? {},
        rule_version: entry.rule_version ?? '',
        regulation: deriveRegulationTag(
          Array.isArray(entry.regulation) ? entry.regulation : entry.regulation ? [entry.regulation] : []
        ),
        reviewer_id: entry.reviewer_id ?? null,
        reviewer_action: entry.reviewer_action ?? null,
        role: entry.role,
        prev_hash: entry.prev_hash,
        entry_hash: entry.entry_hash,
        created_at: entry.created_at,
      },
    });
  }

  async query(filters: AuditQueryFilters): Promise<AuditEntryRecord[]> {
    const where: Record<string, unknown> = {};
    if (filters.user_id) where.user_id = filters.user_id;
    if (filters.user_ids && filters.user_ids.length > 0) where.user_id = { in: filters.user_ids };
    if (filters.from || filters.to) {
      const range: Record<string, unknown> = {};
      if (filters.from) range.gte = new Date(filters.from);
      if (filters.to) range.lte = new Date(filters.to);
      where.created_at = range;
    }
    const rows = await this.prisma.auditEntry.findMany({ where, orderBy: { sequence: 'asc' } });
    return rows.map(fromPrismaRow);
  }

  async getById(id: string): Promise<AuditEntryRecord | null> {
    const row = await this.prisma.auditEntry.findUnique({ where: { id } });
    return row ? fromPrismaRow(row) : null;
  }

  async getChainTail(): Promise<{ sequence: number; entry_hash: string } | null> {
    const row = await this.prisma.auditEntry.findFirst({ orderBy: { sequence: 'desc' } });
    return row ? { sequence: row.sequence, entry_hash: row.entry_hash } : null;
  }
}

/**
 * Normalized input to `AuditService.recordAuditEvent` — the one `recordAuditEvent(...)` contract
 * every producer (CFE, licensing, data-rights, future account-security) and every future
 * content-producing WP calls (§5.7). Domain-specific event shapes (CFEAuditEvent,
 * LicensingAuditEvent, DataRightsAuditEvent) are adapted onto this shape by `./sinks.ts`; nothing
 * about that adaptation touches the domain's own emit-side logic.
 */
export interface RecordAuditEventInput {
  /** Which producer this event came from — purely descriptive metadata, not itself persisted as a
   *  column (folded into `event_data` for querying/reporting). */
  domain: 'cfe' | 'licensing' | 'data_rights' | 'account_security';
  user_id: string;
  role: Role;
  content_id?: string | null;
  /** Human-readable narrative of the event. Always required and non-empty — an audit trail entry
   *  that can't say what happened is as bad as a blank screen (§17.7's "never render blank/no
   *  narrative" doctrine applies to evidence rows too). */
  content_text: string;
  /** Precomputed content hash if the caller already has one (CFE always does); computed from
   *  `content_text` via SHA-256 otherwise. */
  content_hash?: string;
  channel?: Channel | string | null;
  /** CFE risk score (0-100). Non-CFE domains default to 0 — "no risk score" is not the same signal
   *  as the CFE's lowest band, so this is never left undefined/NaN on the row (§17.7). */
  risk_score?: number;
  /** CFE outcome (`PASS`/`FLAG`/`BLOCK`) for CFE decisions, or the domain-neutral `RECORDED` for
   *  every non-CFE event (licensing transitions, data-rights lifecycle events, security events) —
   *  those are informational audit evidence, not a CFE risk-band adjudication, so they are never
   *  mapped onto PASS/FLAG/BLOCK (that would misrepresent a licensing state change as a compliance
   *  content verdict). */
  outcome: CFEDecision | 'RECORDED';
  /** The full domain-specific payload (classifier scores + results for CFE; from/to state +
   *  jurisdiction + reason for licensing; event type + detail for data-rights). Persisted verbatim
   *  in the row's `classifier_data` JSON column — the one flexible field every domain writes its
   *  specifics into, so the physical schema doesn't need a column per producer. */
  event_data: Record<string, unknown>;
  /** Coarse compliance-domain tag (e.g. `FINRA`, `STATE_INSURANCE`, `GDPR`, `CCPA`, or a
   *  producer-specific string like `SECURITY` for T-12). This is what the data-rights legal-hold
   *  carve-out (`DataRightsService`) filters on (`regulation: 'FINRA'`) to decide what a GDPR/CCPA
   *  deletion may never touch — see `deriveRegulationTag` above for how a CFE event's
   *  `Regulation[]` collapses to this single string without ever losing a FINRA tag. */
  regulation: string;
  rule_version: string;
  reviewer_id?: string | null;
  reviewer_action?: string | null;
  /** ISO 8601. Defaults to `now()`. */
  timestamp?: string;
}

export class AuditService {
  constructor(private repository: AuditRepository) {}

  /**
   * THE integration point (§5.7): every producer's event, normalized to `RecordAuditEventInput`,
   * is appended here. Computes the hash-chain fields (`sequence`, `prev_hash`, `entry_hash`) from
   * the repository's current chain tail and appends through the append-only `AuditRepository`.
   * Returns the new row's id.
   */
  async recordAuditEvent(input: RecordAuditEventInput): Promise<string> {
    const id = randomUUID();
    const tail = await this.repository.getChainTail();
    const sequence = tail ? tail.sequence + 1 : 1;
    const prevHash = tail ? tail.entry_hash : GENESIS_PREV_HASH;
    const created_at = input.timestamp ?? new Date().toISOString();
    const content_hash = input.content_hash ?? sha256Hex(input.content_text);
    const channel = normalizeChannel(input.channel);

    const hashable = {
      id,
      sequence,
      user_id: input.user_id,
      content_id: input.content_id ?? null,
      content_text: input.content_text,
      content_hash,
      channel,
      risk_score: input.risk_score ?? 0,
      outcome: input.outcome,
      classifier_data: input.event_data,
      rule_version: input.rule_version,
      regulation: input.regulation,
      reviewer_id: input.reviewer_id ?? null,
      reviewer_action: input.reviewer_action ?? null,
      role: input.role,
      created_at,
    };

    const entry_hash = computeEntryHash(hashable, prevHash);

    const record: AuditEntryRecord = {
      id,
      sequence,
      user_id: input.user_id,
      content_hash,
      risk_score: hashable.risk_score,
      outcome: input.outcome,
      classifier_data: input.event_data,
      role: input.role,
      created_at,
      prev_hash: prevHash,
      entry_hash,
      content_id: input.content_id ?? null,
      content_text: input.content_text,
      channel,
      rule_version: input.rule_version,
      regulation: input.regulation,
      reviewer_id: input.reviewer_id ?? null,
      reviewer_action: input.reviewer_action ?? null,
    };

    await this.repository.append(record);
    return id;
  }

  /**
   * Legacy CFE-shaped entry point (pre-dates `recordAuditEvent`/T-10's unified store). Kept for
   * backward compatibility with anything constructing the older `AuditPayload` shape directly;
   * internally normalizes onto `recordAuditEvent` so every row — regardless of entry point — goes
   * through the same hash chain.
   */
  async recordDecision(payload: AuditPayload): Promise<string> {
    return this.recordAuditEvent({
      domain: 'cfe',
      user_id: payload.user_id,
      role: payload.role,
      content_id: undefined,
      content_text: payload.content_text,
      content_hash: payload.content_hash,
      channel: payload.channel,
      risk_score: payload.risk_score,
      outcome: payload.outcome,
      event_data: {
        classifier_scores: payload.classifier_scores,
        classifier_results: payload.classifier_results,
        safe_harbor_injected: payload.safe_harbor_injected,
        safe_harbor_disclaimers: payload.safe_harbor_disclaimers,
      },
      regulation: deriveRegulationTag(payload.regulation),
      rule_version: payload.rule_version ?? CFE_RULE_VERSION,
      reviewer_id: payload.reviewer_id,
      reviewer_action: payload.reviewer_action,
      timestamp: payload.timestamp,
    });
  }

  /** Query audit entries by filters — the read side of the §5.7 integration points. */
  async query(filters: AuditQueryFilters): Promise<AuditEntryRecord[]> {
    return this.repository.query(filters);
  }

  /** Get a single audit entry by id. */
  async getById(id: string): Promise<AuditEntryRecord | null> {
    return this.repository.getById(id);
  }

  /** The current chain tail — the hook point for an external checkpoint/anchoring job. */
  async getChainHead(): Promise<{ sequence: number; entry_hash: string } | null> {
    return this.repository.getChainTail();
  }

  /**
   * Re-verifies tamper-evidence over every row matching `filters` (defaults to the whole store).
   * This is the proof surface: `{ valid: false }` means the chain has been mutated or a row has
   * been deleted since it was written — see `./hash-chain.ts`.
   */
  async verifyStoredChain(filters: AuditQueryFilters = {}): Promise<ChainVerificationResult> {
    const rows = await this.repository.query(filters);
    return verifyChain(rows as ChainedEntry[]);
  }
}

/** SHA-256 of arbitrary text, hex-encoded — used when a caller doesn't already have a content hash. */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Non-CFE producers (licensing/data-rights/account-security) have no channel; CFE's `Channel`
 *  passes through untouched. Never returns `undefined` (a JSON column should hold `null`, not an
 *  absent key, for "no channel applies"). */
function normalizeChannel(channel: Channel | string | null | undefined): string | null {
  return channel ?? null;
}
