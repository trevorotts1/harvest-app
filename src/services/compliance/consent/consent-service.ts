import {
  ConsentType,
  ALL_CONSENT_TYPES,
  TCPA_CONSENT_TYPE,
} from '@/types/compliance';

/**
 * Consent Management Service for WP11.
 *
 * Manages user consent per data type with versioning, timestamps,
 * and revocability. TCPA SMS consent is tracked separately from
 * general consent.
 */

export interface ConsentRecord {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  given: boolean;
  version: number;
  timestamp: string;
  revoked_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ConsentRepository {
  write(record: ConsentRecord): Promise<void>;
  getLatest(user_id: string, consent_type: ConsentType): Promise<ConsentRecord | null>;
  getAll(user_id: string): Promise<ConsentRecord[]>;
  revoke(user_id: string, consent_type: ConsentType): Promise<void>;
}

/**
 * In-memory consent repository for testing.
 */
export class InMemoryConsentRepository implements ConsentRepository {
  private records: Map<string, ConsentRecord> = new Map();
  private currentVersion = 1;

  async write(record: ConsentRecord): Promise<void> {
    this.records.set(record.id, { ...record });
  }

  async getLatest(user_id: string, consent_type: ConsentType): Promise<ConsentRecord | null> {
    const matches = Array.from(this.records.values())
      .filter((r) => r.user_id === user_id && r.consent_type === consent_type)
      .sort((a, b) => b.version - a.version);
    return matches[0] ?? null;
  }

  async getAll(user_id: string): Promise<ConsentRecord[]> {
    return Array.from(this.records.values()).filter((r) => r.user_id === user_id);
  }

  async revoke(user_id: string, consent_type: ConsentType): Promise<void> {
    const latest = await this.getLatest(user_id, consent_type);
    if (latest) {
      latest.given = false;
      latest.revoked_at = new Date().toISOString();
      this.records.set(latest.id, latest);
    }
  }

  /** Test helper */
  count(): number {
    return this.records.size;
  }

  /** Test helper */
  clear(): void {
    this.records.clear();
  }
}

export class ConsentService {
  constructor(private repository: ConsentRepository) {}

  /**
   * Capture consent for a specific data type.
   * Creates a new versioned, timestamped record.
   */
  async captureConsent(
    user_id: string,
    consent_type: ConsentType,
    given: boolean,
    metadata?: Record<string, unknown>
  ): Promise<ConsentRecord> {
    // Find current version to increment
    const existing = await this.repository.getLatest(user_id, consent_type);
    const version = existing ? existing.version + 1 : 1;

    const record: ConsentRecord = {
      id: crypto.randomUUID(),
      user_id,
      consent_type,
      given,
      version,
      timestamp: new Date().toISOString(),
      metadata,
    };

    await this.repository.write(record);
    return record;
  }

  /**
   * Check if user has given consent for a specific data type.
   */
  async hasConsent(user_id: string, consent_type: ConsentType): Promise<boolean> {
    const record = await this.repository.getLatest(user_id, consent_type);
    return record?.given === true;
  }

  /**
   * Revoke consent for a specific data type.
   */
  async revokeConsent(user_id: string, consent_type: ConsentType): Promise<void> {
    await this.repository.revoke(user_id, consent_type);
  }

  /**
   * Get all consent records for a user.
   */
  async getAllConsents(user_id: string): Promise<ConsentRecord[]> {
    return this.repository.getAll(user_id);
  }

  /**
   * Capture TCPA-specific SMS consent.
   * This is separate from general consent per WP11 §4.1.
   */
  async captureTCPAConsent(user_id: string, given: boolean): Promise<ConsentRecord> {
    return this.captureConsent(user_id, TCPA_CONSENT_TYPE, given, {
      tcpa_specific: true,
      description: 'TCPA-compliant SMS outreach consent',
    });
  }

  /**
   * Check if user has TCPA SMS consent.
   */
  async hasTCPAConsent(user_id: string): Promise<boolean> {
    return this.hasConsent(user_id, TCPA_CONSENT_TYPE);
  }

  /**
   * Revoke TCPA SMS consent.
   * Per WP11: opt-out must halt all SMS within 60 seconds.
   */
  async revokeTCPAConsent(user_id: string): Promise<void> {
    return this.revokeConsent(user_id, TCPA_CONSENT_TYPE);
  }

  /**
   * Bulk-capture initial consent for all data types at signup.
   */
  async captureSignupConsent(
    user_id: string,
    consentedTypes: ConsentType[]
  ): Promise<ConsentRecord[]> {
    const records: ConsentRecord[] = [];
    for (const ct of ALL_CONSENT_TYPES) {
      const given = consentedTypes.includes(ct);
      const record = await this.captureConsent(user_id, ct, given);
      records.push(record);
    }
    return records;
  }
}