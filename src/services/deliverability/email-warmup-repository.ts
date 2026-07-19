// T-36 (§10.3) — repository interfaces + in-memory/Prisma-backed implementations for
// EmailDomainAuthentication and EmailWarmupPlan. Same conventions as a2p-repository.ts.

import { EmailDomainAuthenticationRecord, EmailWarmupPlanRecord } from '../../types/deliverability';

function key(organizationId: string, domain: string): string {
  return `${organizationId}::${domain}`;
}

export interface EmailDomainAuthRepository {
  get(organizationId: string, domain: string): Promise<EmailDomainAuthenticationRecord | null>;
  upsert(record: EmailDomainAuthenticationRecord): Promise<void>;
  /** Every sending domain this org has ever run an authentication check for — used by the SC5
   *  admin status surface to enumerate "which domains does this org even have," not just a single
   *  named domain. */
  listForOrganization(organizationId: string): Promise<EmailDomainAuthenticationRecord[]>;
}

export interface EmailWarmupRepository {
  get(organizationId: string, domain: string): Promise<EmailWarmupPlanRecord | null>;
  upsert(record: EmailWarmupPlanRecord): Promise<void>;
  listForOrganization(organizationId: string): Promise<EmailWarmupPlanRecord[]>;
}

// ─── In-memory implementations ─────────────────────────────────────────────────────────────────

export class InMemoryEmailDomainAuthRepository implements EmailDomainAuthRepository {
  private records = new Map<string, EmailDomainAuthenticationRecord>();

  async get(organizationId: string, domain: string): Promise<EmailDomainAuthenticationRecord | null> {
    return this.records.get(key(organizationId, domain)) ?? null;
  }
  async upsert(record: EmailDomainAuthenticationRecord): Promise<void> {
    this.records.set(key(record.organization_id, record.sending_domain), { ...record });
  }
  async listForOrganization(organizationId: string): Promise<EmailDomainAuthenticationRecord[]> {
    return Array.from(this.records.values()).filter((r) => r.organization_id === organizationId);
  }
  clear(): void {
    this.records.clear();
  }
}

export class InMemoryEmailWarmupRepository implements EmailWarmupRepository {
  private records = new Map<string, EmailWarmupPlanRecord>();

  async get(organizationId: string, domain: string): Promise<EmailWarmupPlanRecord | null> {
    return this.records.get(key(organizationId, domain)) ?? null;
  }
  async upsert(record: EmailWarmupPlanRecord): Promise<void> {
    this.records.set(key(record.organization_id, record.sending_domain), { ...record });
  }
  async listForOrganization(organizationId: string): Promise<EmailWarmupPlanRecord[]> {
    return Array.from(this.records.values()).filter((r) => r.organization_id === organizationId);
  }
  clear(): void {
    this.records.clear();
  }
}

// ─── Prisma-backed implementations ─────────────────────────────────────────────────────────────

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
function isoOfNullable(value: Date | string | null): string | null {
  return value === null ? null : isoOf(value);
}

export interface EmailDomainAuthPrismaRow {
  id: string;
  organization_id: string;
  sending_domain: string;
  spf_status: string;
  dkim_status: string;
  dmarc_status: string;
  last_checked_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface EmailDomainAuthPrismaDelegate {
  findUnique(args: {
    where: { organization_id_sending_domain: { organization_id: string; sending_domain: string } };
  }): Promise<EmailDomainAuthPrismaRow | null>;
  findMany(args: { where: { organization_id: string } }): Promise<EmailDomainAuthPrismaRow[]>;
  upsert(args: {
    where: { organization_id_sending_domain: { organization_id: string; sending_domain: string } };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<EmailDomainAuthPrismaRow>;
}

function domainAuthFromRow(row: EmailDomainAuthPrismaRow): EmailDomainAuthenticationRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    sending_domain: row.sending_domain,
    spf_status: row.spf_status as EmailDomainAuthenticationRecord['spf_status'],
    dkim_status: row.dkim_status as EmailDomainAuthenticationRecord['dkim_status'],
    dmarc_status: row.dmarc_status as EmailDomainAuthenticationRecord['dmarc_status'],
    last_checked_at: isoOfNullable(row.last_checked_at),
    created_at: isoOf(row.created_at),
    updated_at: isoOf(row.updated_at),
  };
}

export class PrismaEmailDomainAuthRepository implements EmailDomainAuthRepository {
  constructor(private db: { emailDomainAuthentication: EmailDomainAuthPrismaDelegate }) {}

  async get(organizationId: string, domain: string): Promise<EmailDomainAuthenticationRecord | null> {
    const row = await this.db.emailDomainAuthentication.findUnique({
      where: { organization_id_sending_domain: { organization_id: organizationId, sending_domain: domain } },
    });
    return row ? domainAuthFromRow(row) : null;
  }

  async listForOrganization(organizationId: string): Promise<EmailDomainAuthenticationRecord[]> {
    const rows = await this.db.emailDomainAuthentication.findMany({ where: { organization_id: organizationId } });
    return rows.map(domainAuthFromRow);
  }

  async upsert(record: EmailDomainAuthenticationRecord): Promise<void> {
    await this.db.emailDomainAuthentication.upsert({
      where: {
        organization_id_sending_domain: {
          organization_id: record.organization_id,
          sending_domain: record.sending_domain,
        },
      },
      create: {
        id: record.id,
        organization_id: record.organization_id,
        sending_domain: record.sending_domain,
        spf_status: record.spf_status,
        dkim_status: record.dkim_status,
        dmarc_status: record.dmarc_status,
        last_checked_at: record.last_checked_at,
      },
      update: {
        spf_status: record.spf_status,
        dkim_status: record.dkim_status,
        dmarc_status: record.dmarc_status,
        last_checked_at: record.last_checked_at,
      },
    });
  }
}

export interface EmailWarmupPlanPrismaRow {
  id: string;
  organization_id: string;
  sending_domain: string;
  stage: string;
  started_at: Date | string | null;
  current_day: number;
  daily_volume_cap: number;
  target_daily_volume: number;
  sent_today: number;
  last_send_date: string | null;
  paused_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface EmailWarmupPlanPrismaDelegate {
  findUnique(args: {
    where: { organization_id_sending_domain: { organization_id: string; sending_domain: string } };
  }): Promise<EmailWarmupPlanPrismaRow | null>;
  findMany(args: { where: { organization_id: string } }): Promise<EmailWarmupPlanPrismaRow[]>;
  upsert(args: {
    where: { organization_id_sending_domain: { organization_id: string; sending_domain: string } };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<EmailWarmupPlanPrismaRow>;
}

function warmupFromRow(row: EmailWarmupPlanPrismaRow): EmailWarmupPlanRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    sending_domain: row.sending_domain,
    stage: row.stage as EmailWarmupPlanRecord['stage'],
    started_at: isoOfNullable(row.started_at),
    current_day: row.current_day,
    daily_volume_cap: row.daily_volume_cap,
    target_daily_volume: row.target_daily_volume,
    sent_today: row.sent_today,
    last_send_date: row.last_send_date,
    paused_reason: row.paused_reason,
    created_at: isoOf(row.created_at),
    updated_at: isoOf(row.updated_at),
  };
}

export class PrismaEmailWarmupRepository implements EmailWarmupRepository {
  constructor(private db: { emailWarmupPlan: EmailWarmupPlanPrismaDelegate }) {}

  async get(organizationId: string, domain: string): Promise<EmailWarmupPlanRecord | null> {
    const row = await this.db.emailWarmupPlan.findUnique({
      where: { organization_id_sending_domain: { organization_id: organizationId, sending_domain: domain } },
    });
    return row ? warmupFromRow(row) : null;
  }

  async listForOrganization(organizationId: string): Promise<EmailWarmupPlanRecord[]> {
    const rows = await this.db.emailWarmupPlan.findMany({ where: { organization_id: organizationId } });
    return rows.map(warmupFromRow);
  }

  async upsert(record: EmailWarmupPlanRecord): Promise<void> {
    await this.db.emailWarmupPlan.upsert({
      where: {
        organization_id_sending_domain: {
          organization_id: record.organization_id,
          sending_domain: record.sending_domain,
        },
      },
      create: {
        id: record.id,
        organization_id: record.organization_id,
        sending_domain: record.sending_domain,
        stage: record.stage,
        started_at: record.started_at,
        current_day: record.current_day,
        daily_volume_cap: record.daily_volume_cap,
        target_daily_volume: record.target_daily_volume,
        sent_today: record.sent_today,
        last_send_date: record.last_send_date,
        paused_reason: record.paused_reason,
      },
      update: {
        stage: record.stage,
        started_at: record.started_at,
        current_day: record.current_day,
        daily_volume_cap: record.daily_volume_cap,
        target_daily_volume: record.target_daily_volume,
        sent_today: record.sent_today,
        last_send_date: record.last_send_date,
        paused_reason: record.paused_reason,
      },
    });
  }
}
