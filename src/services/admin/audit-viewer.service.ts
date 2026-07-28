import type { AuditEntryRecord, AuditQueryFilters } from '@/services/compliance/audit/audit-service';
import { AuditService } from '@/services/compliance/audit/audit-service';
import type { ChainVerificationResult } from '@/services/compliance/audit/hash-chain';

/**
 * T-R56 (admin console — the AUDIT / SECURITY VIEWER, read-only, ADMIN-gated). Reads the SAME two
 * immutable stores every other WP already writes to — `AuditEntry` (via `AuditService`, T-10) and
 * `SecurityEvent` (via the narrow delegate below, T-12) — and surfaces the hash-chain integrity
 * proof (`AuditService.verifyStoredChain`) so an operator can SEE, not just trust, that the trail is
 * untampered. Never writes to either store — this is a pure reader.
 *
 * `AuditRepository.query()` has no `skip`/`take` of its own (T-10's contract is filter-by-user/date,
 * not a page API) — pagination here is applied AFTER the filtered fetch, in-memory, same
 * proportionality call `ActivityLedgerService` already makes for its own read side. Acceptable at
 * this app's current audit-log volume; a future high-volume deployment would want a real
 * `LIMIT`/`OFFSET` on the repository itself.
 */
export interface SecurityEventRow {
  id: string;
  user_id: string | null;
  type: string;
  severity: string;
  created_at: Date | string;
}

export interface SecurityEventPrismaDelegate {
  findMany(args: { orderBy?: Record<string, unknown>; skip?: number; take?: number }): Promise<SecurityEventRow[]>;
  count(): Promise<number>;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function clampPaging(page?: number, pageSize?: number): { page: number; pageSize: number } {
  return {
    page: page && page > 0 ? Math.floor(page) : 1,
    pageSize: pageSize && pageSize > 0 ? Math.min(Math.floor(pageSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
  };
}

export class AuditViewerService {
  constructor(
    private readonly auditService: AuditService,
    private readonly securityEvents: SecurityEventPrismaDelegate
  ) {}

  async listAuditEntries(
    filters: AuditQueryFilters = {},
    paging: { page?: number; pageSize?: number } = {}
  ): Promise<PagedResult<AuditEntryRecord>> {
    const { page, pageSize } = clampPaging(paging.page, paging.pageSize);
    const all = await this.auditService.query(filters);
    // `query()` returns ascending sequence order; the viewer wants newest-first.
    const descending = [...all].reverse();
    const start = (page - 1) * pageSize;
    return {
      items: descending.slice(start, start + pageSize),
      page,
      pageSize,
      total: all.length,
      totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
    };
  }

  /** The tamper-evidence proof surface (§16.1) — hash-chain-only, no anchoring dependency required. */
  async verifyAuditChain(): Promise<ChainVerificationResult> {
    return this.auditService.verifyStoredChain();
  }

  async listSecurityEvents(paging: { page?: number; pageSize?: number } = {}): Promise<PagedResult<SecurityEventRow>> {
    const { page, pageSize } = clampPaging(paging.page, paging.pageSize);
    const [rows, total] = await Promise.all([
      this.securityEvents.findMany({ orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.securityEvents.count(),
    ]);
    return { items: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
}
