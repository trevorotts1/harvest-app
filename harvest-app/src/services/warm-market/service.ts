import { PrismaClient } from '@prisma/client';
import {
  ContactRecord,
  RelationshipType,
  PipelineStage,
  ContactDataClassification,
  SegmentScoreFactors,
  calculateSegmentScore,
  calculateHiddenEarnings,
  HiddenEarningsEstimate,
  HIDDEN_EARNINGS_DISCLAIMER,
  RELATIONSHIP_WEIGHTS,
  inferRelationshipType,
  isValidTransition,
  PIPELINE_TRANSITIONS,
  containsForbiddenTerms,
  IOSContactPayload,
  IOS_CONTACTS_NORMALIZATION,
  AndroidContactPayload,
  ANDROID_CONTACTS_NORMALIZATION,
  CSVFieldMapping,
  CSV_IMPORT_LIMITS,
  ConflictResolution,
  IngestionResult,
  WP04AgentFeed,
  WP05MessagePersonalization,
  FIELD_DATA_CLASSIFICATION,
  MEMORY_JOGGER_CATEGORIES,
  shouldTriggerMemoryJogger,
} from '../../types/warm-market';
import { encrypt, decrypt } from '../compliance/encryption/encryption';

const prisma = new PrismaClient();

// ─── Contact Service ──────────────────────────────────────────────────

export class ContactService {
  // ── Import ──────────────────────────────────────────────────────────

  async importContacts(
    userId: string,
    contacts: Omit<ContactRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[],
    source: string,
    conflictResolution: ConflictResolution = 'skip'
  ): Promise<IngestionResult> {
    const batchId = crypto.randomUUID();
    let imported = 0;
    let skipped = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];

      // Check for forbidden terms in user-facing fields
      const nameCheck = containsForbiddenTerms(`${contact.firstName} ${contact.lastName}`);
      const notesCheck = contact.notes ? containsForbiddenTerms(contact.notes) : { found: false, terms: [] as string[] };
      if (nameCheck.found || notesCheck.found) {
        const allTerms = [...(nameCheck.found ? nameCheck.terms : []), ...(notesCheck.found ? notesCheck.terms : [])];
        errors.push({
          row: i,
          message: `Forbidden sales terms found: ${allTerms.join(', ')}`,
        });
        skipped++;
        continue;
      }

      // Deduplication: check existing by phone or email
      const existing = await this.findDuplicate(userId, contact.phone, contact.email);

      if (existing) {
        if (conflictResolution === 'skip') {
          skipped++;
          continue;
        } else if (conflictResolution === 'overwrite') {
          await prisma.contact.update({
            where: { id: existing.id },
            data: {
              first_name: contact.firstName,
              last_name: contact.lastName,
              relationship_type: contact.relationshipType,
              segment_score: contact.segmentScore,
              last_contact_date: contact.lastContactDate,
              notes: contact.notes,
              source,
              import_batch_id: batchId,
            },
          });
          imported++;
          continue;
        } else if (conflictResolution === 'merge') {
          await prisma.contact.update({
            where: { id: existing.id },
            data: {
              notes: [existing.notes, contact.notes].filter(Boolean).join('\n'),
              segment_score: Math.max(existing.segment_score, contact.segmentScore),
              import_batch_id: batchId,
            },
          });
          imported++;
          continue;
        } else {
          errors.push({ row: i, message: 'Duplicate contact and conflict resolution is error' });
          skipped++;
          continue;
        }
      }

      try {
        await prisma.contact.create({
          data: {
            user_id: userId,
            first_name: contact.firstName,
            last_name: contact.lastName,
            phone: contact.phone,
            email: contact.email,
            relationship_type: contact.relationshipType,
            pipeline_stage: (contact.pipelineStage ?? PipelineStage.NEW) as any,
            segment_score: contact.segmentScore,
            segment_score_factors: contact.segmentScoreFactors ? (JSON.parse(JSON.stringify(contact.segmentScoreFactors)) as any) : undefined,
            is_recruit_target: contact.isRecruitTarget,
            is_client: contact.isClient,
            is_a_list: contact.isAList,
            last_contact_date: contact.lastContactDate,
            notes: contact.notes,
            source,
            import_batch_id: batchId,
            data_classification: (contact.dataClassification ?? ContactDataClassification.RESTRICTED) as any,
            consent_given_at: contact.consentGivenAt,
            life_events: contact.lifeEvents ? (JSON.parse(JSON.stringify(contact.lifeEvents)) as any) : undefined,
            trust_score: contact.trustScore,
          },
        });
        imported++;
      } catch (err: any) {
        errors.push({ row: i, message: err.message ?? 'Unknown error' });
        skipped++;
      }
    }

    return {
      imported,
      skipped,
      errors: errors.length,
      errorDetails: errors.length > 0 ? errors : undefined,
      importBatchId: batchId,
    };
  }

  // ── Deduplication ───────────────────────────────────────────────────

  private async findDuplicate(
    userId: string,
    phone?: string | null,
    email?: string | null
  ): Promise<any> {
    if (phone) {
      const byPhone = await prisma.contact.findFirst({
        where: { user_id: userId, phone },
      });
      if (byPhone) return byPhone;
    }
    if (email) {
      const byEmail = await prisma.contact.findFirst({
        where: { user_id: userId, email },
      });
      if (byEmail) return byEmail;
    }
    return null;
  }

  // ── iOS Native Ingestion ───────────────────────────────────────────

  normalizeIOSContact(raw: IOSContactPayload): Omit<ContactRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'> {
    const firstName = raw.givenName?.trim() || IOS_CONTACTS_NORMALIZATION.emptyNameFallback;
    const lastName = raw.familyName?.trim() || '';
    const phone = raw.phoneNumbers?.[0]?.value
      ? (IOS_CONTACTS_NORMALIZATION.phoneStripNonDigits ? raw.phoneNumbers[0].value.replace(/\D/g, '') : raw.phoneNumbers[0].value)
      : undefined;
    const email = raw.emailAddresses?.[0]?.value
      ? (IOS_CONTACTS_NORMALIZATION.emailLowercase ? raw.emailAddresses[0].value.toLowerCase() : raw.emailAddresses[0].value)
      : undefined;

    return {
      firstName,
      lastName,
      phone,
      email,
      relationshipType: inferRelationshipType({}),
      pipelineStage: PipelineStage.NEW,
      segmentScore: 0,
      isRecruitTarget: false,
      isClient: false,
      isAList: false,
      source: 'ios_contacts',
      dataClassification: ContactDataClassification.RESTRICTED,
      notes: raw.note || undefined,
    };
  }

  // ── Android Native Ingestion ──────────────────────────────────────

  normalizeAndroidContact(raw: AndroidContactPayload): Omit<ContactRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'> {
    let firstName = raw.givenName || '';
    let lastName = raw.familyName || '';
    if (ANDROID_CONTACTS_NORMALIZATION.nameSplitDisplay && !firstName && raw.displayName) {
      const parts = raw.displayName.split(' ');
      firstName = parts[0] || ANDROID_CONTACTS_NORMALIZATION.emptyNameFallback;
      lastName = parts.slice(1).join(' ') || '';
    }
    firstName = firstName.trim() || ANDROID_CONTACTS_NORMALIZATION.emptyNameFallback;
    lastName = lastName.trim();
    const phone = raw.phoneNumbers?.[0]?.number
      ? (ANDROID_CONTACTS_NORMALIZATION.phoneStripNonDigits ? raw.phoneNumbers[0].number.replace(/\D/g, '') : raw.phoneNumbers[0].number)
      : undefined;
    const email = raw.emailAddresses?.[0]?.address
      ? (ANDROID_CONTACTS_NORMALIZATION.emailLowercase ? raw.emailAddresses[0].address.toLowerCase() : raw.emailAddresses[0].address)
      : undefined;

    return {
      firstName,
      lastName,
      phone,
      email,
      relationshipType: inferRelationshipType({}),
      pipelineStage: PipelineStage.NEW,
      segmentScore: 0,
      isRecruitTarget: false,
      isClient: false,
      isAList: false,
      source: 'android_contacts',
      dataClassification: ContactDataClassification.RESTRICTED,
      notes: raw.note || undefined,
    };
  }

  // ── CSV Ingestion ───────────────────────────────────────────────────

  validateCSVImport(rows: unknown[], mapping: CSVFieldMapping[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (rows.length > CSV_IMPORT_LIMITS.MAX_ROWS) {
      errors.push(`Exceeds maximum rows: ${rows.length} > ${CSV_IMPORT_LIMITS.MAX_ROWS}`);
    }
    const mappedFields = mapping.map((m) => m.contactField);
    for (const req of CSV_IMPORT_LIMITS.REQUIRED_COLUMNS) {
      if (!mappedFields.includes(req)) {
        errors.push(`Missing required column mapping: ${req}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  // ── Segment Scoring ────────────────────────────────────────────────

  computeSegmentScore(factors: SegmentScoreFactors): number {
    return calculateSegmentScore(factors);
  }

  computeRecencyScore(lastContactDate: Date | null): number {
    if (!lastContactDate) return 0;
    const daysSince = Math.floor((Date.now() - new Date(lastContactDate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince <= 7) return 100;
    if (daysSince <= 30) return 80;
    if (daysSince <= 90) return 50;
    if (daysSince <= 180) return 30;
    return 10;
  }

  computeEngagementScore(interactionCount: number, lastInteractionDate: Date | null): number {
    const countScore = Math.min(100, interactionCount * 10);
    const recency = this.computeRecencyScore(lastInteractionDate);
    return Math.round((countScore * 0.5) + (recency * 0.5));
  }

  // ── Hidden Earnings ────────────────────────────────────────────────

  calculateEarningsEstimate(contactCount: number, avgClientValue = 350): HiddenEarningsEstimate {
    return calculateHiddenEarnings(contactCount, avgClientValue);
  }

  // ── Pipeline ────────────────────────────────────────────────────────

  validatePipelineTransition(from: PipelineStage, to: PipelineStage): boolean {
    return isValidTransition(from, to);
  }

  // ── Memory Jogger ───────────────────────────────────────────────────

  getMemoryJoggerCategories() {
    return MEMORY_JOGGER_CATEGORIES;
  }

  getCategoriesNeedingJogger(categoryCounts: Record<string, number>): string[] {
    return MEMORY_JOGGER_CATEGORIES
      .filter((cat) => {
        const count = categoryCounts[cat.key] ?? 0;
        return shouldTriggerMemoryJogger(count);
      })
      .map((cat) => cat.key);
  }

  // ── WP11 Privacy: Encryption ───────────────────────────────────────

  encryptContactPII(contact: { phone?: string | null; email?: string | null; notes?: string | null }, keyBase64: string) {
    const piiData = JSON.stringify({
      phone: contact.phone,
      email: contact.email,
      notes: contact.notes,
    });
    const result = encrypt(piiData, keyBase64);
    return {
      encryptedPiiPayload: result.ciphertext,
      encryptedPiiIv: result.iv,
      encryptedPiiAuthTag: result.authTag,
    };
  }

  decryptContactPII(
    encryptedPayload: string,
    iv: string,
    authTag: string,
    keyBase64: string
  ): { phone?: string | null; email?: string | null; notes?: string | null } {
    const decrypted = decrypt({ ciphertext: encryptedPayload, iv, authTag }, keyBase64);
    return JSON.parse(decrypted);
  }

  // ── WP11 Privacy: Data Classification ──────────────────────────────

  classifyField(fieldName: string): ContactDataClassification {
    return FIELD_DATA_CLASSIFICATION[fieldName] ?? ContactDataClassification.INTERNAL;
  }

  // ── WP04 Agent Feed ─────────────────────────────────────────────────

  buildAgentFeed(contact: ContactRecord, consentSms: boolean, consentEmail: boolean): WP04AgentFeed {
    const daysSince = contact.lastContactDate
      ? Math.floor((Date.now() - new Date(contact.lastContactDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      contactId: contact.id,
      userId: contact.userId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      relationshipType: contact.relationshipType,
      pipelineStage: contact.pipelineStage,
      segmentScore: contact.segmentScore,
      lastContactDate: contact.lastContactDate ? new Date(contact.lastContactDate).toISOString() : null,
      trustScore: contact.trustScore ?? null,
      lifeEvents: contact.lifeEvents ?? null,
      isRecruitTarget: contact.isRecruitTarget,
      isClient: contact.isClient,
      daysSinceLastContact: daysSince,
      consentSms,
      consentEmail,
    };
  }

  // ── WP05 Message Personalization ────────────────────────────────────

  buildMessagePersonalization(
    contact: ContactRecord,
    recentInteractionSummary?: string | null
  ): WP05MessagePersonalization {
    return {
      contactId: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      relationshipType: contact.relationshipType,
      pipelineStage: contact.pipelineStage,
      lastContactDate: contact.lastContactDate ? new Date(contact.lastContactDate).toISOString() : null,
      lifeEvents: contact.lifeEvents ?? null,
      notes: contact.notes ?? null,
      recentInteractionSummary: recentInteractionSummary ?? null,
    };
  }
}

export const contactService = new ContactService();