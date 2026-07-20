// T-36 (§10.3) — repository interfaces + in-memory/Prisma-backed implementations for
// A2PBrandRegistration, A2PCampaignRegistration, and PlatformPhoneNumber. Mirrors
// src/services/compliance/licensing/licensing-repository.ts's exact shape: a narrow interface, an
// in-memory implementation for tests, and a Prisma-backed implementation keyed off a narrow
// delegate type (never the full PrismaClient) with Date<->ISO-string mapping at the boundary only.

import {
  A2PBrandRecord,
  A2PCampaignRecord,
  PlatformNumberStatus,
  PlatformPhoneNumberRecord,
} from '../../types/deliverability';

export interface A2PBrandRepository {
  get(organizationId: string): Promise<A2PBrandRecord | null>;
  upsert(record: A2PBrandRecord): Promise<void>;
}

export interface A2PCampaignRepository {
  get(organizationId: string): Promise<A2PCampaignRecord | null>;
  upsert(record: A2PCampaignRecord): Promise<void>;
}

export interface PlatformPhoneNumberRepository {
  get(phoneNumber: string): Promise<PlatformPhoneNumberRecord | null>;
  getById(id: string): Promise<PlatformPhoneNumberRecord | null>;
  getActiveForOrganization(organizationId: string): Promise<PlatformPhoneNumberRecord[]>;
  upsert(record: PlatformPhoneNumberRecord): Promise<void>;
}

// ─── In-memory implementations (tests / not-yet-DB-wired callers) ─────────────────────────────

export class InMemoryA2PBrandRepository implements A2PBrandRepository {
  private records = new Map<string, A2PBrandRecord>();

  async get(organizationId: string): Promise<A2PBrandRecord | null> {
    return this.records.get(organizationId) ?? null;
  }
  async upsert(record: A2PBrandRecord): Promise<void> {
    this.records.set(record.organization_id, { ...record });
  }
  clear(): void {
    this.records.clear();
  }
}

export class InMemoryA2PCampaignRepository implements A2PCampaignRepository {
  private records = new Map<string, A2PCampaignRecord>();

  async get(organizationId: string): Promise<A2PCampaignRecord | null> {
    return this.records.get(organizationId) ?? null;
  }
  async upsert(record: A2PCampaignRecord): Promise<void> {
    this.records.set(record.organization_id, { ...record });
  }
  clear(): void {
    this.records.clear();
  }
}

export class InMemoryPlatformPhoneNumberRepository implements PlatformPhoneNumberRepository {
  private byNumber = new Map<string, PlatformPhoneNumberRecord>();

  async get(phoneNumber: string): Promise<PlatformPhoneNumberRecord | null> {
    return this.byNumber.get(phoneNumber) ?? null;
  }
  async getById(id: string): Promise<PlatformPhoneNumberRecord | null> {
    for (const rec of this.byNumber.values()) {
      if (rec.id === id) return rec;
    }
    return null;
  }
  async getActiveForOrganization(organizationId: string): Promise<PlatformPhoneNumberRecord[]> {
    return Array.from(this.byNumber.values()).filter(
      (r) => r.organization_id === organizationId && r.status !== 'RELEASED'
    );
  }
  async upsert(record: PlatformPhoneNumberRecord): Promise<void> {
    this.byNumber.set(record.phone_number, { ...record });
  }
  clear(): void {
    this.byNumber.clear();
  }
}

// ─── Prisma-backed implementations (production path) ──────────────────────────────────────────

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
function isoOfNullable(value: Date | string | null): string | null {
  return value === null ? null : isoOf(value);
}

export interface A2PBrandPrismaRow {
  id: string;
  organization_id: string;
  twilio_brand_sid: string | null;
  status: string;
  entity_type: string | null;
  failure_reason: string | null;
  submitted_at: Date | string | null;
  approved_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface A2PBrandPrismaDelegate {
  findUnique(args: { where: { organization_id: string } }): Promise<A2PBrandPrismaRow | null>;
  upsert(args: {
    where: { organization_id: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<A2PBrandPrismaRow>;
}

function brandFromRow(row: A2PBrandPrismaRow): A2PBrandRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    twilio_brand_sid: row.twilio_brand_sid,
    status: row.status as A2PBrandRecord['status'],
    entity_type: row.entity_type,
    failure_reason: row.failure_reason,
    submitted_at: isoOfNullable(row.submitted_at),
    approved_at: isoOfNullable(row.approved_at),
    created_at: isoOf(row.created_at),
    updated_at: isoOf(row.updated_at),
  };
}

export class PrismaA2PBrandRepository implements A2PBrandRepository {
  constructor(private db: { a2PBrandRegistration: A2PBrandPrismaDelegate }) {}

  async get(organizationId: string): Promise<A2PBrandRecord | null> {
    const row = await this.db.a2PBrandRegistration.findUnique({ where: { organization_id: organizationId } });
    return row ? brandFromRow(row) : null;
  }

  async upsert(record: A2PBrandRecord): Promise<void> {
    await this.db.a2PBrandRegistration.upsert({
      where: { organization_id: record.organization_id },
      create: {
        id: record.id,
        organization_id: record.organization_id,
        twilio_brand_sid: record.twilio_brand_sid,
        status: record.status,
        entity_type: record.entity_type,
        failure_reason: record.failure_reason,
        submitted_at: record.submitted_at,
        approved_at: record.approved_at,
      },
      update: {
        twilio_brand_sid: record.twilio_brand_sid,
        status: record.status,
        entity_type: record.entity_type,
        failure_reason: record.failure_reason,
        submitted_at: record.submitted_at,
        approved_at: record.approved_at,
      },
    });
  }
}

export interface A2PCampaignPrismaRow {
  id: string;
  organization_id: string;
  twilio_campaign_sid: string | null;
  status: string;
  use_case: string;
  opt_in_language: string;
  throughput_tier: string | null;
  failure_reason: string | null;
  submitted_at: Date | string | null;
  approved_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface A2PCampaignPrismaDelegate {
  findUnique(args: { where: { organization_id: string } }): Promise<A2PCampaignPrismaRow | null>;
  upsert(args: {
    where: { organization_id: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<A2PCampaignPrismaRow>;
}

function campaignFromRow(row: A2PCampaignPrismaRow): A2PCampaignRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    twilio_campaign_sid: row.twilio_campaign_sid,
    status: row.status as A2PCampaignRecord['status'],
    use_case: row.use_case,
    opt_in_language: row.opt_in_language,
    throughput_tier: row.throughput_tier,
    failure_reason: row.failure_reason,
    submitted_at: isoOfNullable(row.submitted_at),
    approved_at: isoOfNullable(row.approved_at),
    created_at: isoOf(row.created_at),
    updated_at: isoOf(row.updated_at),
  };
}

export class PrismaA2PCampaignRepository implements A2PCampaignRepository {
  constructor(private db: { a2PCampaignRegistration: A2PCampaignPrismaDelegate }) {}

  async get(organizationId: string): Promise<A2PCampaignRecord | null> {
    const row = await this.db.a2PCampaignRegistration.findUnique({ where: { organization_id: organizationId } });
    return row ? campaignFromRow(row) : null;
  }

  async upsert(record: A2PCampaignRecord): Promise<void> {
    await this.db.a2PCampaignRegistration.upsert({
      where: { organization_id: record.organization_id },
      create: {
        id: record.id,
        organization_id: record.organization_id,
        twilio_campaign_sid: record.twilio_campaign_sid,
        status: record.status,
        use_case: record.use_case,
        opt_in_language: record.opt_in_language,
        throughput_tier: record.throughput_tier,
        failure_reason: record.failure_reason,
        submitted_at: record.submitted_at,
        approved_at: record.approved_at,
      },
      update: {
        twilio_campaign_sid: record.twilio_campaign_sid,
        status: record.status,
        use_case: record.use_case,
        opt_in_language: record.opt_in_language,
        throughput_tier: record.throughput_tier,
        failure_reason: record.failure_reason,
        submitted_at: record.submitted_at,
        approved_at: record.approved_at,
      },
    });
  }
}

export interface PlatformPhoneNumberPrismaRow {
  id: string;
  organization_id: string;
  phone_number: string;
  twilio_phone_number_sid: string | null;
  campaign_registration_id: string | null;
  status: string;
  released_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PlatformPhoneNumberPrismaDelegate {
  findUnique(args: { where: { phone_number: string } }): Promise<PlatformPhoneNumberPrismaRow | null>;
  findUniqueById?(args: { where: { id: string } }): Promise<PlatformPhoneNumberPrismaRow | null>;
  findMany(args: {
    where: { organization_id: string; status: { not: PlatformNumberStatus } };
  }): Promise<PlatformPhoneNumberPrismaRow[]>;
  upsert(args: {
    where: { phone_number: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<PlatformPhoneNumberPrismaRow>;
}

function numberFromRow(row: PlatformPhoneNumberPrismaRow): PlatformPhoneNumberRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    phone_number: row.phone_number,
    twilio_phone_number_sid: row.twilio_phone_number_sid,
    campaign_registration_id: row.campaign_registration_id,
    status: row.status as PlatformPhoneNumberRecord['status'],
    released_at: isoOfNullable(row.released_at),
    created_at: isoOf(row.created_at),
    updated_at: isoOf(row.updated_at),
  };
}

export class PrismaPlatformPhoneNumberRepository implements PlatformPhoneNumberRepository {
  constructor(private db: { platformPhoneNumber: PlatformPhoneNumberPrismaDelegate }) {}

  async get(phoneNumber: string): Promise<PlatformPhoneNumberRecord | null> {
    const row = await this.db.platformPhoneNumber.findUnique({ where: { phone_number: phoneNumber } });
    return row ? numberFromRow(row) : null;
  }

  async getById(id: string): Promise<PlatformPhoneNumberRecord | null> {
    if (!this.db.platformPhoneNumber.findUniqueById) return null;
    const row = await this.db.platformPhoneNumber.findUniqueById({ where: { id } });
    return row ? numberFromRow(row) : null;
  }

  async getActiveForOrganization(organizationId: string): Promise<PlatformPhoneNumberRecord[]> {
    const rows = await this.db.platformPhoneNumber.findMany({
      where: { organization_id: organizationId, status: { not: 'RELEASED' } },
    });
    return rows.map(numberFromRow);
  }

  async upsert(record: PlatformPhoneNumberRecord): Promise<void> {
    await this.db.platformPhoneNumber.upsert({
      where: { phone_number: record.phone_number },
      create: {
        id: record.id,
        organization_id: record.organization_id,
        phone_number: record.phone_number,
        twilio_phone_number_sid: record.twilio_phone_number_sid,
        campaign_registration_id: record.campaign_registration_id,
        status: record.status,
        released_at: record.released_at,
      },
      update: {
        twilio_phone_number_sid: record.twilio_phone_number_sid,
        campaign_registration_id: record.campaign_registration_id,
        status: record.status,
        released_at: record.released_at,
      },
    });
  }
}
