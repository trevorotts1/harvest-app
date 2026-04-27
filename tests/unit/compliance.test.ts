import { ComplianceFilterEngine } from '../../src/services/compliance/engine';

// Use fake timers to prevent Jest hang from setTimeout in reviewWithTimeout
jest.useFakeTimers();

describe('ComplianceFilterEngine', () => {
  let engine: ComplianceFilterEngine;

  beforeEach(() => {
    engine = new ComplianceFilterEngine();
  });

  test('should block content with high risk (BLOCK)', async () => {
    const result = await engine.review({
      content: 'guaranteed income with this business opportunity sign up today',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(result.outcome).toBe('BLOCK');
    expect(result.risk_score).toBeGreaterThan(70);
    expect(result.http_status).toBe(403);
    expect(result.blocked).toBe(true);
  });

  test('should flag content with medium risk (FLAG)', async () => {
    const result = await engine.review({
      content: 'This extra income opportunity could work for you',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(result.outcome).toBe('FLAG');
    expect(result.risk_score).toBeGreaterThan(10);
    expect(result.risk_score).toBeLessThanOrEqual(70);
  });

  test('should pass safe content (PASS)', async () => {
    const result = await engine.review({
      content: 'Hi, how was your day? Would you like to grab coffee this weekend?',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(result.outcome).toBe('PASS');
    expect(result.risk_score).toBeLessThanOrEqual(10);
    expect(result.blocked).toBe(false);
  });

  test('should calculate real classifier scores', async () => {
    const result = await engine.review({
      content: 'life insurance policy with guaranteed income and coverage options',
      channel: 'EMAIL',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(result.classifier_data.INSURANCE).toBeGreaterThan(0);
    expect(result.classifier_data.INCOME_CLAIM).toBeGreaterThan(0);
    expect(result.classifier_data.OPPORTUNITY).toBe(0);
  });

  test('should handle edge cases', async () => {
    const emptyResult = await engine.review({
      content: '',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(emptyResult.outcome).toBe('PASS');
    expect(emptyResult.risk_score).toBe(0);
    
    const specialChars = await engine.review({
      content: '!!! @#$%^&* ()',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(specialChars.outcome).toBe('PASS');

    const veryLongContent = await engine.review({
      content: 'a'.repeat(10000),
      channel: 'EMAIL',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(veryLongContent.outcome).toBe('PASS');
  });

  test('should invoke onDecision callback', async () => {
    const onDecision = jest.fn();
    const eng = new ComplianceFilterEngine({ onDecision });
    await eng.review({
      content: 'hello friend',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(onDecision).toHaveBeenCalled();
  });

  test('should block when CFE is unavailable (fail-closed)', async () => {
    engine.setAvailability(false);
    const result = await engine.review({
      content: 'safe content that would normally pass',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(result.outcome).toBe('BLOCK');
    expect(result.http_status).toBe(403);
    expect(result.blocked).toBe(true);
  });

  test('should record audit trail', async () => {
    const result = await engine.review({
      content: 'test audit trail content',
      channel: 'EMAIL',
      userContext: { user_id: '456', role: 'UPLINE', regulations: ['FINRA'] }
    });
    expect(result.audit_payload).toBeDefined();
    expect(result.audit_payload.user_id).toBe('456');
    expect(result.audit_payload.role).toBe('UPLINE');
    expect(result.audit_payload.channel).toBe('EMAIL');
    expect(result.audit_payload.content_hash).toBeDefined();
    expect(result.audit_payload.rule_version).toBe('1.0.0');

    const auditService = engine.getAuditService();
    const records = await auditService.query({ user_id: '456' });
    expect(records.length).toBe(1);
    expect(records[0].risk_score).toBe(result.risk_score);
  });
});
