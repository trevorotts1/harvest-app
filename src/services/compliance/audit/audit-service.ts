import {
  AuditPayload,
  Classifier,
  CFEDecision,
  Role,
  Channel,
  Regulation,
  CFE_RULE_VERSION,
} from '@/types/compliance';

/**
 * Audit persistence service for WP11.
 * Writes AuditEntry records through a repository interface.
 * Design matches Prisma AuditEntry model for future DB swap.
 */

export interface AuditEntryRecord {
  id: string;
  user_id: string;
  content_hash: string;
  risk_score: number;
  outcome: CFEDecision;
  classifier_data: Record<string, unknown>;
  role: Role;
  created_at: string;
  // Extended fields beyond Prisma model (stored in classifier_data JSON or separate table)
  content_text?: string;
  classifier_scores?: Record<Classifier, number>;
  classifier_results?: unknown[];
  safe_harbor_injected?: boolean;
  safe_harbor_disclaimers?: string[];
  channel?: Channel;
  rule_version?: string;
  regulation?: Regulation[];
  reviewer_id?: string;
  reviewer_action?: string;
}

export interface AuditRepository {
  write(entry: AuditEntryRecord): Promise<void>;
  query(filters: { user_id?: string; from?: string; to?: string }): Promise<AuditEntryRecord[]>;
  getById(id: string): Promise<AuditEntryRecord | null>;
}

/**
 * In-memory audit repository for testing.
 * Production would use Prisma-backed repository.
 */
export class InMemoryAuditRepository implements AuditRepository {
  private entries: Map<string, AuditEntryRecord> = new Map();

  async write(entry: AuditEntryRecord): Promise<void> {
    this.entries.set(entry.id, { ...entry });
  }

  async query(filters: { user_id?: string; from?: string; to?: string }): Promise<AuditEntryRecord[]> {
    let results = Array.from(this.entries.values());
    if (filters.user_id) {
      results = results.filter((e) => e.user_id === filters.user_id);
    }
    if (filters.from) {
      results = results.filter((e) => e.created_at >= filters.from!);
    }
    if (filters.to) {
      results = results.filter((e) => e.created_at <= filters.to!);
    }
    return results;
  }

  async getById(id: string): Promise<AuditEntryRecord | null> {
    return this.entries.get(id) ?? null;
  }

  /** Test helper: count entries */
  count(): number {
    return this.entries.size;
  }

  /** Test helper: get all entries */
  all(): AuditEntryRecord[] {
    return Array.from(this.entries.values());
  }

  /** Test helper: clear */
  clear(): void {
    this.entries.clear();
  }
}

export class AuditService {
  constructor(private repository: AuditRepository) {}

  /**
   * Persist a CFE audit entry.
   * Converts the CFE audit_payload into a record matching the Prisma AuditEntry model.
   */
  async recordDecision(payload: AuditPayload): Promise<string> {
    const id = crypto.randomUUID();
    const entry: AuditEntryRecord = {
      id,
      user_id: payload.user_id,
      content_hash: payload.content_hash,
      risk_score: payload.risk_score,
      outcome: payload.outcome,
      classifier_data: payload.classifier_scores,
      role: payload.role,
      created_at: payload.timestamp,
      content_text: payload.content_text,
      classifier_scores: payload.classifier_scores,
      classifier_results: payload.classifier_results,
      safe_harbor_injected: payload.safe_harbor_injected,
      safe_harbor_disclaimers: payload.safe_harbor_disclaimers,
      channel: payload.channel,
      rule_version: payload.rule_version,
      regulation: payload.regulation,
      reviewer_id: payload.reviewer_id,
      reviewer_action: payload.reviewer_action,
    };

    await this.repository.write(entry);
    return id;
  }

  /**
   * Query audit entries by filters.
   */
  async query(filters: { user_id?: string; from?: string; to?: string }): Promise<AuditEntryRecord[]> {
    return this.repository.query(filters);
  }

  /**
   * Get a single audit entry by ID.
   */
  async getById(id: string): Promise<AuditEntryRecord | null> {
    return this.repository.getById(id);
  }
}