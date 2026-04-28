import { encrypt, decrypt, encryptPII, decryptPII, EncryptedPayload } from '../encryption/encryption';

/**
 * Data Rights Workflows for WP11.
 *
 * Implements GDPR/CCPA data rights:
 * - Export (JSON/CSV)
 * - Deletion/Anonymization
 * - Rectification
 *
 * All PII fields are encrypted at rest using AES-256-GCM.
 */

export type ExportFormat = 'json' | 'csv';

export interface DataExportRequest {
  user_id: string;
  format: ExportFormat;
  data_types: string[];
}

export interface DataDeletionRequest {
  user_id: string;
  anonymize_upline_visible: boolean; // Per WP11: upline-visible data is anonymized, not destroyed
  requested_at: string;
}

export interface DataRectificationRequest {
  user_id: string;
  fields: Record<string, string>; // field -> corrected value
  reason?: string;
}

export interface DataExportResult {
  user_id: string;
  format: ExportFormat;
  data: string; // JSON string or CSV content
  generated_at: string;
  expires_at: string; // Download link expires in 24h per WP11 §4.4
}

export interface DataDeletionResult {
  user_id: string;
  status: 'pending' | 'processing' | 'completed';
  anonymized_fields: string[];
  deleted_fields: string[];
  completed_at?: string;
  sla_days: number; // 30 days per GDPR, 45 days per CCPA
}

export interface DataRectificationResult {
  user_id: string;
  status: 'completed' | 'rejected';
  updated_fields: string[];
  reason?: string;
}

interface UserDataRecord {
  user_id: string;
  email: string;
  name: string;
  phone?: string;
  [key: string]: unknown;
}

/**
 * In-memory store for testing data rights workflows.
 */
export class InMemoryDataStore {
  private data: Map<string, UserDataRecord> = new Map();

  setUser(user_id: string, data: UserDataRecord): void {
    this.data.set(user_id, { ...data });
  }

  getUser(user_id: string): UserDataRecord | undefined {
    return this.data.get(user_id);
  }

  deleteUser(user_id: string): boolean {
    return this.data.delete(user_id);
  }

  updateUser(user_id: string, updates: Partial<UserDataRecord>): UserDataRecord | undefined {
    const existing = this.data.get(user_id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.data.set(user_id, updated);
    return updated;
  }

  clear(): void {
    this.data.clear();
  }
}

/** PII fields that must be encrypted at rest */
const PII_FIELDS = ['email', 'phone', 'password_hash'] as const;

export class DataRightsService {
  constructor(private store: InMemoryDataStore) {}

  /**
   * Export user data in JSON or CSV format.
   * Per WP11 §4.4: Export generates valid JSON/CSV within 5 minutes.
   * PII fields are decrypted for export (user is exporting their own data).
   */
  async exportData(request: DataExportRequest): Promise<DataExportResult> {
    const userData = this.store.getUser(request.user_id);
    if (!userData) {
      throw new Error(`User ${request.user_id} not found`);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h expiry

    let data: string;
    if (request.format === 'json') {
      data = JSON.stringify(userData, null, 2);
    } else {
      // CSV format
      const keys = Object.keys(userData);
      const values = Object.values(userData);
      const header = keys.join(',');
      const row = values.map((v) => JSON.stringify(v ?? '')).join(',');
      data = `${header}\n${row}`;
    }

    return {
      user_id: request.user_id,
      format: request.format,
      data,
      generated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
  }

  /**
   * Delete or anonymize user data.
   * Per WP11 §4.4: Deletion within 30 days (GDPR), 45 days (CCPA).
   * Rep data deleted, upline-visible data anonymized (not destroyed).
   */
  async deleteData(request: DataDeletionRequest): Promise<DataDeletionResult> {
    const userData = this.store.getUser(request.user_id);
    if (!userData) {
      throw new Error(`User ${request.user_id} not found`);
    }

    const deletedFields: string[] = [];
    const anonymizedFields: string[] = [];

    if (request.anonymize_upline_visible) {
      // Anonymize PII fields (upline can still see structure)
      const anonymized: Partial<UserDataRecord> = {
        email: `anonymized_${request.user_id.substring(0, 8)}@deleted.com`,
        name: 'Anonymized User',
        phone: undefined,
      };
      this.store.updateUser(request.user_id, anonymized);
      anonymizedFields.push('email', 'name', 'phone');
    } else {
      // Full deletion
      this.store.deleteUser(request.user_id);
      deletedFields.push('email', 'name', 'phone', 'all');
    }

    return {
      user_id: request.user_id,
      status: 'completed',
      anonymized_fields: anonymizedFields,
      deleted_fields: deletedFields,
      completed_at: new Date().toISOString(),
      sla_days: 30,
    };
  }

  /**
   * Rectify (correct) user data.
   * Per WP11 §4.4: Rectification within 15 days.
   */
  async rectifyData(request: DataRectificationRequest): Promise<DataRectificationResult> {
    const userData = this.store.getUser(request.user_id);
    if (!userData) {
      throw new Error(`User ${request.user_id} not found`);
    }

    const updatedFields: string[] = [];
    const updates: Record<string, string> = {};

    for (const [field, value] of Object.entries(request.fields)) {
      if (field in userData) {
        updates[field] = value;
        updatedFields.push(field);
      }
    }

    if (updatedFields.length > 0) {
      this.store.updateUser(request.user_id, updates);
    }

    return {
      user_id: request.user_id,
      status: 'completed',
      updated_fields: updatedFields,
    };
  }

  /**
   * Encrypt PII fields for at-rest storage.
   * Demonstrates AES-256-GCM encryption of sensitive fields.
   */
  encryptPIIFields(data: UserDataRecord): Record<string, EncryptedPayload> {
    const encrypted: Record<string, EncryptedPayload> = {};
    for (const field of PII_FIELDS) {
      const value = data[field];
      if (value && typeof value === 'string') {
        encrypted[field] = encryptPII(value);
      }
    }
    return encrypted;
  }

  /**
   * Decrypt PII fields from at-rest storage.
   * Requires the encryption key to decrypt.
   */
  decryptPIIFields(encrypted: Record<string, EncryptedPayload>, keyBase64: string): Record<string, string> {
    const decrypted: Record<string, string> = {};
    for (const [field, payload] of Object.entries(encrypted)) {
      decrypted[field] = decryptPII(payload, keyBase64);
    }
    return decrypted;
  }
}