import { ConsentType, ALL_CONSENT_TYPES, TCPA_CONSENT_TYPE } from '../../../types/compliance';
import { randomUUID } from 'crypto';

/**
 * Consent Management System
 * Per-data-type consent records, versioned, timestamped, revocable.
 * Separate TCPA SMS consent handling.
 */

export interface ConsentRecord {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  given: boolean;
  version: number;
  timestamp: string; // ISO 8601
  revocable: boolean;
  source: string; // 'signup' | 'settings' | 'api' | 'manual'
  ip_address?: string;
  metadata?: Record<string, unknown>;
}

export interface TCPAConsentRecord extends ConsentRecord {
  consent_type: 'sms_outreach';
  phone_number: string;
  opt_in_timestamp: string;
  opt_out_timestamp?: string;
  opt_in_method: 'web_form' | 'sms_keyword' | 'manual_entry' | 'api';
  opt_out_method?: 'sms_keyword' | 'web_form' | 'api' | 'manual';
  consent_text_shown: string; // The exact consent language shown to the user
}

export class ConsentManager {
  private consentStore: Map<string, ConsentRecord[]> = new Map();

  /**
   * Grant consent for a specific data type.
   * Creates a new versioned, timestamped record.
   */
  grantConsent(
    userId: string,
    consentType: ConsentType,
    source: string = 'signup',
    ipAddress?: string,
    metadata?: Record<string, unknown>
  ): ConsentRecord {
    const existing = this.getConsent(userId, consentType);
    const version = existing ? existing.version + 1 : 1;

    const record: ConsentRecord = {
      id: randomUUID(),
      user_id: userId,
      consent_type: consentType,
      given: true,
      version,
      timestamp: new Date().toISOString(),
      revocable: true,
      source,
      ip_address: ipAddress,
      metadata,
    };

    const key = `${userId}:${consentType}`;
    const records = this.consentStore.get(key) || [];
    records.push(record);
    this.consentStore.set(key, records);

    return record;
  }

  /**
   * Revoke consent for a specific data type.
   * Creates a new versioned record with given=false.
   */
  revokeConsent(
    userId: string,
    consentType: ConsentType,
    source: string = 'settings'
  ): ConsentRecord {
    const existing = this.getConsent(userId, consentType);
    const version = existing ? existing.version + 1 : 1;

    const record: ConsentRecord = {
      id: randomUUID(),
      user_id: userId,
      consent_type: consentType,
      given: false,
      version,
      timestamp: new Date().toISOString(),
      revocable: true,
      source,
    };

    const key = `${userId}:${consentType}`;
    const records = this.consentStore.get(key) || [];
    records.push(record);
    this.consentStore.set(key, records);

    return record;
  }

  /**
   * Get the current (latest version) consent for a data type.
   */
  getConsent(userId: string, consentType: ConsentType): ConsentRecord | null {
    const key = `${userId}:${consentType}`;
    const records = this.consentStore.get(key);
    if (!records || records.length === 0) return null;
    return records[records.length - 1];
  }

  /**
   * Check if consent is currently given for a data type.
   */
  hasConsent(userId: string, consentType: ConsentType): boolean {
    const record = this.getConsent(userId, consentType);
    return record?.given ?? false;
  }

  /**
   * Grant TCPA-specific SMS consent with required fields.
   */
  grantTCPAConsent(
    userId: string,
    phoneNumber: string,
    optInMethod: TCPAConsentRecord['opt_in_method'],
    consentTextShown: string,
    ipAddress?: string
  ): TCPAConsentRecord {
    const existing = this.getConsent(userId, 'sms_outreach') as TCPAConsentRecord | null;
    const version = existing ? existing.version + 1 : 1;

    const record: TCPAConsentRecord = {
      id: randomUUID(),
      user_id: userId,
      consent_type: 'sms_outreach',
      given: true,
      version,
      timestamp: new Date().toISOString(),
      revocable: true,
      source: 'tcpa_sms',
      ip_address: ipAddress,
      phone_number: phoneNumber,
      opt_in_timestamp: new Date().toISOString(),
      opt_in_method: optInMethod,
      consent_text_shown: consentTextShown,
    };

    const key = `${userId}:sms_outreach`;
    const records = this.consentStore.get(key) || [];
    records.push(record);
    this.consentStore.set(key, records);

    return record;
  }

  /**
   * Revoke TCPA SMS consent. Per TCPA rules, opt-out must halt SMS within 60 seconds.
   */
  revokeTCPAConsent(
    userId: string,
    optOutMethod: TCPAConsentRecord['opt_out_method']
  ): TCPAConsentRecord {
    const existing = this.getConsent(userId, 'sms_outreach') as TCPAConsentRecord | null;
    const version = existing ? existing.version + 1 : 1;

    const record: TCPAConsentRecord = {
      id: randomUUID(),
      user_id: userId,
      consent_type: 'sms_outreach',
      given: false,
      version,
      timestamp: new Date().toISOString(),
      revocable: true,
      source: 'tcpa_sms',
      phone_number: existing?.phone_number || '',
      opt_in_timestamp: existing?.opt_in_timestamp || '',
      opt_out_timestamp: new Date().toISOString(),
      opt_out_method: optOutMethod,
      consent_text_shown: existing?.consent_text_shown || '',
      opt_in_method: existing?.opt_in_method || 'manual_entry',
    };

    const key = `${userId}:sms_outreach`;
    const records = this.consentStore.get(key) || [];
    records.push(record);
    this.consentStore.set(key, records);

    return record;
  }

  /**
   * Get consent history (all versions) for a data type.
   */
  getConsentHistory(userId: string, consentType: ConsentType): ConsentRecord[] {
    const key = `${userId}:${consentType}`;
    return this.consentStore.get(key) || [];
  }

  /**
   * Check all consent types for a user.
   * Returns a map of consent_type → current consent state.
   */
  getAllConsent(userId: string): Record<ConsentType, boolean> {
    const result = {} as Record<ConsentType, boolean>;
    for (const ct of ALL_CONSENT_TYPES) {
      result[ct] = this.hasConsent(userId, ct);
    }
    return result;
  }

  /**
   * Check if user has all required consents for a given channel.
   */
  hasChannelConsent(userId: string, channel: 'SMS' | 'EMAIL' | 'SOCIAL' | 'PHONE'): boolean {
    switch (channel) {
      case 'SMS':
        // TCPA requires explicit SMS consent
        return this.hasConsent(userId, 'sms_outreach') && this.hasConsent(userId, 'contacts');
      case 'EMAIL':
        return this.hasConsent(userId, 'email_outreach') && this.hasConsent(userId, 'contacts');
      case 'SOCIAL':
        return this.hasConsent(userId, 'contacts');
      case 'PHONE':
        return this.hasConsent(userId, 'sms_outreach') && this.hasConsent(userId, 'contacts');
      default:
        return false;
    }
  }
}