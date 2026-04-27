import {
  contactService,
  ContactService,
} from '../../src/services/warm-market/service';
import {
  RelationshipType,
  RELATIONSHIP_WEIGHTS,
  PipelineStage,
  PIPELINE_TRANSITIONS,
  isValidTransition,
  calculateSegmentScore,
  calculateHiddenEarnings,
  HIDDEN_EARNINGS_DISCLAIMER,
  inferRelationshipType,
  containsForbiddenTerms,
  FORBIDDEN_SALES_TERMS,
  MEMORY_JOGGER_CATEGORIES,
  shouldTriggerMemoryJogger,
  LOW_CONTACT_TRIGGER_THRESHOLD,
  CSV_IMPORT_LIMITS,
  ContactDataClassification,
  FIELD_DATA_CLASSIFICATION,
  SegmentScoreFactors,
  IOSContactPayload,
  AndroidContactPayload,
  WP04AgentFeed,
  WP05MessagePersonalization,
} from '../../src/types/warm-market';
import { encrypt, decrypt } from '../../src/services/compliance/encryption/encryption';

// ─── Hidden Earnings ──────────────────────────────────────────────────

describe('Hidden Earnings calculation', () => {
  it('calculates with default avgClientValue=350', () => {
    const estimate = calculateHiddenEarnings(20);
    expect(estimate.estimatedAppointments).toBe(5);
    expect(estimate.estimatedClients).toBe(1);
    expect(estimate.estimatedMonthlyValue).toBe(350);
    expect(estimate.avgMonthlyValue).toBe(350);
  });

  it('calculates with custom avgClientValue', () => {
    const estimate = calculateHiddenEarnings(100, 500);
    expect(estimate.estimatedAppointments).toBe(25);
    expect(estimate.estimatedClients).toBe(5);
    expect(estimate.estimatedMonthlyValue).toBe(2500);
    expect(estimate.avgMonthlyValue).toBe(500);
  });

  it('always includes safe-harbor disclaimer', () => {
    const estimate = calculateHiddenEarnings(10);
    expect(estimate.disclaimerText).toBe(HIDDEN_EARNINGS_DISCLAIMER);
    expect(estimate.disclaimerText).toContain('not a guarantee');
    expect(estimate.disclaimerText).toContain('Individual results vary');
  });

  it('handles zero contacts', () => {
    const estimate = calculateHiddenEarnings(0);
    expect(estimate.estimatedAppointments).toBe(0);
    expect(estimate.estimatedClients).toBe(0);
    expect(estimate.estimatedMonthlyValue).toBe(0);
  });

  it('formula: appointments=floor(count*0.25), clients=floor(appts*0.20), value=clients*avg', () => {
    const estimate = calculateHiddenEarnings(8, 100);
    expect(estimate.estimatedAppointments).toBe(Math.floor(8 * 0.25));
    expect(estimate.estimatedClients).toBe(Math.floor(2 * 0.20));
    expect(estimate.estimatedMonthlyValue).toBe(0 * 100); // floor(0.4) = 0
  });
});

// ─── Relationship Taxonomy ────────────────────────────────────────────

describe('Relationship taxonomy', () => {
  it('has all 8 required relationship types', () => {
    const required = ['family', 'friend', 'work', 'church', 'neighbor', 'coach', 'former_colleague', 'other'];
    const actual = Object.values(RelationshipType);
    for (const r of required) {
      expect(actual).toContain(r);
    }
  });

  it('all relationship types have weight assignments', () => {
    for (const rt of Object.values(RelationshipType)) {
      expect(RELATIONSHIP_WEIGHTS[rt]).toBeDefined();
      expect(typeof RELATIONSHIP_WEIGHTS[rt]).toBe('number');
    }
  });

  it('family has highest weight', () => {
    const familyWeight = RELATIONSHIP_WEIGHTS[RelationshipType.FAMILY];
    for (const weight of Object.values(RELATIONSHIP_WEIGHTS)) {
      expect(familyWeight).toBeGreaterThanOrEqual(weight);
    }
  });
});

describe('inferRelationshipType', () => {
  it('infers family', () => {
    expect(inferRelationshipType({ isFamily: true })).toBe(RelationshipType.FAMILY);
  });

  it('infers work (coworker)', () => {
    expect(inferRelationshipType({ isCoworker: true })).toBe(RelationshipType.WORK);
  });

  it('infers church', () => {
    expect(inferRelationshipType({ isChurchAffiliated: true })).toBe(RelationshipType.CHURCH);
  });

  it('infers former colleague', () => {
    expect(inferRelationshipType({ isFormerCoworker: true })).toBe(RelationshipType.FORMER_COLLEAGUE);
  });

  it('defaults to other', () => {
    expect(inferRelationshipType({})).toBe(RelationshipType.OTHER);
  });

  it('family takes priority over other cues', () => {
    expect(inferRelationshipType({ isFamily: true, isCoworker: true })).toBe(RelationshipType.FAMILY);
  });
});

// ─── Pipeline Stages & Transitions ────────────────────────────────────

describe('Pipeline stages and transitions', () => {
  it('has 5 pipeline stages', () => {
    expect(Object.values(PipelineStage)).toHaveLength(5);
  });

  it('allows valid transitions', () => {
    expect(isValidTransition(PipelineStage.NEW, PipelineStage.ENGAGED)).toBe(true);
    expect(isValidTransition(PipelineStage.ENGAGED, PipelineStage.PIPELINE)).toBe(true);
    expect(isValidTransition(PipelineStage.PIPELINE, PipelineStage.ACTIVATED)).toBe(true);
  });

  it('blocks invalid transitions', () => {
    expect(isValidTransition(PipelineStage.NEW, PipelineStage.ACTIVATED)).toBe(false);
    expect(isValidTransition(PipelineStage.ACTIVATED, PipelineStage.NEW)).toBe(false);
  });

  it('allows archival from any active stage', () => {
    for (const stage of [PipelineStage.NEW, PipelineStage.ENGAGED, PipelineStage.PIPELINE, PipelineStage.ACTIVATED]) {
      expect(PIPELINE_TRANSITIONS[stage]).toContain(PipelineStage.ARCHIVED);
    }
  });

  it('archived can restart as new', () => {
    expect(isValidTransition(PipelineStage.ARCHIVED, PipelineStage.NEW)).toBe(true);
  });
});

// ─── Multi-Factor Segment Scoring ─────────────────────────────────────

describe('Multi-factor segment scoring (0-100)', () => {
  it('computes score from all 5 factors', () => {
    const factors: SegmentScoreFactors = {
      relationshipWeight: 80,
      recency: 70,
      lifeEvents: 50,
      engagementHistory: 60,
      trust: 75,
    };
    const score = calculateSegmentScore(factors);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    // Verify weighted: 80*0.25 + 70*0.20 + 50*0.15 + 60*0.25 + 75*0.15 = 20+14+7.5+15+11.25 = 67.75 → 68
    expect(score).toBe(68);
  });

  it('caps at 100', () => {
    const factors: SegmentScoreFactors = {
      relationshipWeight: 100,
      recency: 100,
      lifeEvents: 100,
      engagementHistory: 100,
      trust: 100,
    };
    expect(calculateSegmentScore(factors)).toBe(100);
  });

  it('floors at 0', () => {
    const factors: SegmentScoreFactors = {
      relationshipWeight: 0,
      recency: 0,
      lifeEvents: 0,
      engagementHistory: 0,
      trust: 0,
    };
    expect(calculateSegmentScore(factors)).toBe(0);
  });

  it('weighs engagement history and relationship most', () => {
    const factors: SegmentScoreFactors = {
      relationshipWeight: 100,
      recency: 0,
      lifeEvents: 0,
      engagementHistory: 100,
      trust: 0,
    };
    const score = calculateSegmentScore(factors);
    expect(score).toBe(50); // 25 + 25
  });
});

// ─── Memory Jogger ────────────────────────────────────────────────────

describe('Memory Jogger', () => {
  it('has 7 categories including required ones', () => {
    const keys = MEMORY_JOGGER_CATEGORIES.map((c) => c.key);
    expect(keys).toContain('church');
    expect(keys).toContain('gym');
    expect(keys).toContain('school');
    expect(keys).toContain('work');
    expect(keys).toContain('hobbies');
    expect(keys).toContain('family_friends');
    expect(keys).toContain('former_colleagues');
  });

  it('each category has key, label, and prompt', () => {
    for (const cat of MEMORY_JOGGER_CATEGORIES) {
      expect(cat.key).toBeTruthy();
      expect(cat.label).toBeTruthy();
      expect(cat.prompt).toBeTruthy();
    }
  });

  it('triggers jogger for low-contact categories', () => {
    expect(shouldTriggerMemoryJogger(0)).toBe(true);
    expect(shouldTriggerMemoryJogger(3)).toBe(true);
    expect(shouldTriggerMemoryJogger(5)).toBe(false);
    expect(shouldTriggerMemoryJogger(10)).toBe(false);
  });

  it('LOW_CONTACT_TRIGGER_THRESHOLD is 5', () => {
    expect(LOW_CONTACT_TRIGGER_THRESHOLD).toBe(5);
  });

  it('service returns categories needing jogger', () => {
    const svc = new ContactService();
    const result = svc.getCategoriesNeedingJogger({ church: 2, gym: 10, work: 0 });
    expect(result).toContain('church');
    expect(result).toContain('work');
    expect(result).not.toContain('gym');
  });
});

// ─── Forbidden Sales Terms ────────────────────────────────────────────

describe('Forbidden sales terms', () => {
  it('detects forbidden terms in text', () => {
    const result = containsForbiddenTerms('Let me pitch this prospect');
    expect(result.found).toBe(true);
    expect(result.terms).toContain('pitch');
    expect(result.terms).toContain('prospect');
  });

  it('returns empty for clean text', () => {
    const result = containsForbiddenTerms('Let us connect and share ideas');
    expect(result.found).toBe(false);
    expect(result.terms).toHaveLength(0);
  });

  it('detects all required forbidden terms', () => {
    const required = ['prospect', 'lead', 'pitch', 'sales call', 'guaranteed income'];
    for (const term of required) {
      expect(FORBIDDEN_SALES_TERMS).toContain(term as any);
    }
  });

  it('case-insensitive detection', () => {
    const result = containsForbiddenTerms('This is my Prospect');
    expect(result.found).toBe(true);
  });
});

// ─── Native Mobile Ingestion Contracts ────────────────────────────────

describe('iOS native ingestion contracts', () => {
  it('normalizes an iOS contact', () => {
    const svc = new ContactService();
    const raw: IOSContactPayload = {
      givenName: '  Jane  ',
      familyName: 'Doe',
      phoneNumbers: [{ label: 'mobile', value: '+1 (555) 123-4567' }],
      emailAddresses: [{ label: 'home', value: 'Jane@Example.COM' }],
      note: 'Met at church',
    };
    const result = svc.normalizeIOSContact(raw);
    expect(result.firstName).toBe('Jane');
    expect(result.lastName).toBe('Doe');
    expect(result.phone).toBe('15551234567');
    expect(result.email).toBe('jane@example.com');
    expect(result.source).toBe('ios_contacts');
    expect(result.dataClassification).toBe(ContactDataClassification.RESTRICTED);
  });

  it('falls back to Unknown for empty name', () => {
    const svc = new ContactService();
    const raw: IOSContactPayload = {
      givenName: '',
      familyName: '',
      phoneNumbers: [],
      emailAddresses: [],
    };
    const result = svc.normalizeIOSContact(raw);
    expect(result.firstName).toBe('Unknown');
  });
});

describe('Android native ingestion contracts', () => {
  it('normalizes an Android contact with split display name', () => {
    const svc = new ContactService();
    const raw: AndroidContactPayload = {
      displayName: 'John Smith',
      phoneNumbers: [{ type: 'mobile', number: '555-987-6543' }],
      emailAddresses: [{ type: 'work', address: 'John@Work.COM' }],
    };
    const result = svc.normalizeAndroidContact(raw);
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Smith');
    expect(result.phone).toBe('5559876543');
    expect(result.email).toBe('john@work.com');
    expect(result.source).toBe('android_contacts');
  });

  it('falls back to Unknown for empty display name', () => {
    const svc = new ContactService();
    const raw: AndroidContactPayload = {
      displayName: '',
      phoneNumbers: [],
      emailAddresses: [],
    };
    const result = svc.normalizeAndroidContact(raw);
    expect(result.firstName).toBe('Unknown');
  });
});

// ─── CSV Ingestion Contracts ──────────────────────────────────────────

describe('CSV ingestion contracts', () => {
  it('rejects imports exceeding MAX_ROWS', () => {
    const svc = new ContactService();
    const rows = new Array(CSV_IMPORT_LIMITS.MAX_ROWS + 1).fill({});
    const result = svc.validateCSVImport(rows, [
      { csvColumn: 'first_name', contactField: 'firstName' },
      { csvColumn: 'last_name', contactField: 'lastName' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Exceeds maximum rows');
  });

  it('requires first_name and last_name column mapping', () => {
    const svc = new ContactService();
    const result = svc.validateCSVImport([{}], [
      { csvColumn: 'fname', contactField: 'firstName' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('lastName'))).toBe(true);
  });

  it('passes with valid mapping', () => {
    const svc = new ContactService();
    const result = svc.validateCSVImport([{}], [
      { csvColumn: 'first_name', contactField: 'firstName' },
      { csvColumn: 'last_name', contactField: 'lastName' },
    ]);
    expect(result.valid).toBe(true);
  });
});

// ─── Data Classification ──────────────────────────────────────────────

describe('Data classification per field', () => {
  it('classifies PII fields as RESTRICTED', () => {
    expect(FIELD_DATA_CLASSIFICATION.firstName).toBe(ContactDataClassification.RESTRICTED);
    expect(FIELD_DATA_CLASSIFICATION.lastName).toBe(ContactDataClassification.RESTRICTED);
    expect(FIELD_DATA_CLASSIFICATION.phone).toBe(ContactDataClassification.RESTRICTED);
    expect(FIELD_DATA_CLASSIFICATION.email).toBe(ContactDataClassification.RESTRICTED);
  });

  it('classifies internal fields as INTERNAL', () => {
    expect(FIELD_DATA_CLASSIFICATION.relationshipType).toBe(ContactDataClassification.INTERNAL);
    expect(FIELD_DATA_CLASSIFICATION.segmentScore).toBe(ContactDataClassification.INTERNAL);
    expect(FIELD_DATA_CLASSIFICATION.pipelineStage).toBe(ContactDataClassification.INTERNAL);
  });

  it('service classifyField returns correct classification', () => {
    const svc = new ContactService();
    expect(svc.classifyField('phone')).toBe(ContactDataClassification.RESTRICTED);
    expect(svc.classifyField('notes')).toBe(ContactDataClassification.CONFIDENTIAL);
    expect(svc.classifyField('unknownField')).toBe(ContactDataClassification.INTERNAL);
  });
});

// ─── WP11 Privacy: Encryption ────────────────────────────────────────

describe('WP11 privacy: encryption hooks', () => {
  const testKey = Buffer.from('a'.repeat(32)).toString('base64');

  it('encrypts and decrypts contact PII round-trip', () => {
    const svc = new ContactService();
    const contact = { phone: '555-1234', email: 'test@test.com', notes: 'personal note' };
    const encrypted = svc.encryptContactPII(contact, testKey);
    expect(encrypted.encryptedPiiPayload).toBeTruthy();
    expect(encrypted.encryptedPiiIv).toBeTruthy();
    expect(encrypted.encryptedPiiAuthTag).toBeTruthy();

    const decrypted = svc.decryptContactPII(
      encrypted.encryptedPiiPayload,
      encrypted.encryptedPiiIv,
      encrypted.encryptedPiiAuthTag,
      testKey
    );
    expect(decrypted.phone).toBe('555-1234');
    expect(decrypted.email).toBe('test@test.com');
    expect(decrypted.notes).toBe('personal note');
  });
});

// ─── WP04 Agent Feed Contract ──────────────────────────────────────────

describe('WP04 agent feed contract', () => {
  it('builds agent feed with required fields', () => {
    const svc = new ContactService();
    const contact = {
      id: 'c1',
      userId: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '555-1234',
      email: 'jane@test.com',
      relationshipType: RelationshipType.FAMILY,
      pipelineStage: PipelineStage.ENGAGED,
      segmentScore: 75,
      lastContactDate: new Date('2025-01-01'),
      notes: null,
      source: 'manual',
      importBatchId: null,
      isRecruitTarget: true,
      isClient: false,
      isAList: true,
      dataClassification: ContactDataClassification.RESTRICTED,
      consentGivenAt: null,
      encryptedPiiPayload: null,
      encryptedPiiIv: null,
      encryptedPiiAuthTag: null,
      lifeEvents: [{ type: 'graduation', date: '2024-06-01' }],
      trustScore: 80,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    const feed = svc.buildAgentFeed(contact, true, false);
    expect(feed.contactId).toBe('c1');
    expect(feed.firstName).toBe('Jane');
    expect(feed.relationshipType).toBe(RelationshipType.FAMILY);
    expect(feed.pipelineStage).toBe(PipelineStage.ENGAGED);
    expect(feed.segmentScore).toBe(75);
    expect(feed.consentSms).toBe(true);
    expect(feed.consentEmail).toBe(false);
    expect(feed.lifeEvents).toHaveLength(1);
    expect(feed.daysSinceLastContact).toBeGreaterThanOrEqual(0);
  });
});

// ─── WP05 Message Personalization Contract ─────────────────────────────

describe('WP05 message personalization contract', () => {
  it('builds personalization with required fields', () => {
    const svc = new ContactService();
    const contact = {
      id: 'c1',
      firstName: 'Jane',
      lastName: 'Doe',
      relationshipType: RelationshipType.FRIEND,
      pipelineStage: PipelineStage.PIPELINE,
      lastContactDate: new Date('2025-01-15'),
      notes: 'Loves fitness',
      lifeEvents: null,
    } as any;

    const p = svc.buildMessagePersonalization(contact, 'Had coffee last week');
    expect(p.contactId).toBe('c1');
    expect(p.firstName).toBe('Jane');
    expect(p.relationshipType).toBe(RelationshipType.FRIEND);
    expect(p.pipelineStage).toBe(PipelineStage.PIPELINE);
    expect(p.notes).toBe('Loves fitness');
    expect(p.recentInteractionSummary).toBe('Had coffee last week');
  });

  it('has no forbidden sales terms in personalization fields', () => {
    const svc = new ContactService();
    const contact = {
      id: 'c1',
      firstName: 'Jane',
      lastName: 'Doe',
      relationshipType: RelationshipType.FRIEND,
      pipelineStage: PipelineStage.PIPELINE,
      lastContactDate: null,
      notes: 'Wants to learn about financial education',
      lifeEvents: null,
    } as any;

    const p = svc.buildMessagePersonalization(contact);
    const allText = [p.firstName, p.lastName, p.notes, p.recentInteractionSummary]
      .filter(Boolean)
      .join(' ');
    const check = containsForbiddenTerms(allText);
    expect(check.found).toBe(false);
  });
});

// ─── Recency & Engagement Scoring ─────────────────────────────────────

describe('Recency and engagement scoring', () => {
  it('recency: recent contact gets high score', () => {
    const svc = new ContactService();
    const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(svc.computeRecencyScore(recent)).toBe(100);
  });

  it('recency: null date gives 0', () => {
    const svc = new ContactService();
    expect(svc.computeRecencyScore(null)).toBe(0);
  });

  it('recency: 60 days ago gives 50', () => {
    const svc = new ContactService();
    const d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const score = svc.computeRecencyScore(d);
    expect(score).toBe(50);
  });

  it('engagement: blends count and recency', () => {
    const svc = new ContactService();
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const score = svc.computeEngagementScore(5, recent);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ─── Pipeline Validation ──────────────────────────────────────────────

describe('Pipeline validation in service', () => {
  it('validates transitions via service method', () => {
    const svc = new ContactService();
    expect(svc.validatePipelineTransition(PipelineStage.NEW, PipelineStage.ENGAGED)).toBe(true);
    expect(svc.validatePipelineTransition(PipelineStage.NEW, PipelineStage.ACTIVATED)).toBe(false);
  });
});