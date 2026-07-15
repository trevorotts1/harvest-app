import {
  DataCategory,
  RETENTION_SCHEDULE,
  RetentionRule,
} from '../../../types/data-rights';

/**
 * Retention scheduling for T-11 (master-spec §16.3).
 *
 * This module is deliberately data-model-agnostic: it never queries Prisma directly, because the
 * records it schedules (Subscription, AgentRun, AuditEntry, UserDataDeletion) are owned by other
 * build units. Callers pass in the reference date for each record; RetentionService answers
 * "is this record past its retention window" against the category's rule.
 *
 * The FINRA_COMMUNICATIONS_ARCHIVE category is the legal-hold carve-out set (§16.3): it is
 * flagged `isCarveOut: true` and MUST NEVER be included in a deletion-driven purge — only this
 * module's own long (7-year) schedule governs its eventual retirement, entirely independent of
 * any user GDPR/CCPA deletion request.
 */

export interface RetentionRecordRef {
  /** Caller-supplied identifier for the record (for reporting). */
  id: string;
  /** The date the retention clock runs from for this record, per the category's `basis`. */
  referenceDate: Date;
}

export interface PastRetentionResult extends RetentionRecordRef {
  category: DataCategory;
  cutoff: Date;
  action: RetentionRule['action'];
  isCarveOut: boolean;
}

export class RetentionService {
  /** Return the retention rule for a category (schedule = config, not code — see §16.1). */
  getRule(category: DataCategory): RetentionRule {
    return RETENTION_SCHEDULE[category];
  }

  /** All retention rules, for admin/audit surfaces. */
  getAllRules(): RetentionRule[] {
    return Object.values(RETENTION_SCHEDULE);
  }

  /** The cutoff date before which a record in `category` is past retention. */
  computeCutoff(category: DataCategory, referenceDate: Date): Date {
    const rule = this.getRule(category);
    const cutoff = new Date(referenceDate.getTime());
    cutoff.setUTCDate(cutoff.getUTCDate() + rule.retentionPeriodDays);
    return cutoff;
  }

  /**
   * Is a single record (identified by its reference date) past retention as of `now`?
   * Note: for the FINRA carve-out category this only answers "past its own 7-year archive
   * window" — it is NOT a signal that the record may be deleted as part of a user's GDPR/CCPA
   * deletion request. Deletion processing (see data-rights.ts) never calls this for the carve-out
   * category; it always preserves those records regardless.
   */
  isPastRetention(category: DataCategory, referenceDate: Date, now: Date = new Date()): boolean {
    const cutoff = this.computeCutoff(category, referenceDate);
    return now.getTime() > cutoff.getTime();
  }

  /**
   * Mechanism to identify data past retention (BUILD item 1): scan a batch of records for a
   * category and return those whose reference date is past the cutoff, tagged with the action
   * the schedule prescribes (purge / anonymize / retain_in_segregated_archive).
   */
  findPastRetention(
    category: DataCategory,
    records: RetentionRecordRef[],
    now: Date = new Date()
  ): PastRetentionResult[] {
    const rule = this.getRule(category);
    return records
      .filter((r) => this.isPastRetention(category, r.referenceDate, now))
      .map((r) => ({
        ...r,
        category,
        cutoff: this.computeCutoff(category, r.referenceDate),
        action: rule.action,
        isCarveOut: rule.isCarveOut,
      }));
  }
}

export const retentionService = new RetentionService();
