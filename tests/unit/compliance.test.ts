import { ComplianceFilterEngine } from '../../src/services/compliance/engine';

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
  });

  test('should flag content with medium risk (FLAG)', async () => {
    const result = await engine.review({
      content: 'Hey, I wanted to say hi to a friend.',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    // This content should PASS or be very low risk
    // Let's use something that is clearly FLAG but not BLOCK
    // Actually, "opportunity" is 0.6 weight in OpportunityClassifier
    // Opportunity Classifier weight is 0.15 * 0.6 * 3 = 0.27
    // Let's use something that triggers a single classifier moderately
    const result2 = await engine.review({
      content: 'I have some extra income for you to think about.',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(result2.outcome).toBe('FLAG');
    expect(result2.risk_score).toBeGreaterThan(10);
    expect(result2.risk_score).toBeLessThanOrEqual(70);
  });

  test('should pass safe content (PASS)', async () => {
    const result = await engine.review({
      content: 'Hey, want to grab coffee?',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(result.outcome).toBe('PASS');
    expect(result.risk_score).toBeLessThanOrEqual(10);
  });

  test('should calculate real classifier scores', async () => {
    const result = await engine.review({
      content: 'I love my life insurance policy! It has great coverage and I recommend it to everyone.',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(result.classifier_data.INSURANCE).toBeGreaterThan(0);
    expect(result.classifier_data.INCOME_CLAIM).toBe(0);
    expect(result.classifier_data.OPPORTUNITY).toBe(0);
  });

  test('should handle edge cases', async () => {
    const emptyResult = await engine.review({
      content: '',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(emptyResult.outcome).toBe('PASS');
    
    const specialChars = await engine.review({
      content: '!!! @#$%^&* ()',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP', regulations: [] }
    });
    expect(specialChars.outcome).toBe('PASS');
  });
});