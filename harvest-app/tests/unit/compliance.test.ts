import { ComplianceFilterEngine } from '../../src/services/compliance/engine';

describe('ComplianceFilterEngine', () => {
  const engine = new ComplianceFilterEngine();

  test('should block content with high risk (BLOCK)', async () => {
    const result = await engine.review({
      content: 'Make guaranteed income today! Earn so much money!',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(result.outcome).toBe('BLOCK');
  });

  test('should flag content with medium risk (FLAG)', async () => {
    // Moderate use of "opportunity"
    const result = await engine.review({
      content: 'I have a business opportunity for you.',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(result.outcome).toBe('FLAG');
    expect(result.risk_score).toBeGreaterThan(10);
    expect(result.risk_score).toBeLessThanOrEqual(70);
  });

  test('should pass safe content (PASS)', async () => {
    const result = await engine.review({
      content: 'Hey, want to grab coffee?',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(result.outcome).toBe('PASS');
    expect(result.classifier_data.INCOME_CLAIM).toBe(0);
  });

  test('should calculate real classifier scores', async () => {
    const result = await engine.review({
      content: 'I love my life insurance policy! It has great coverage.',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(result.classifier_data.INSURANCE).toBeGreaterThan(0);
  });

  test('should handle edge cases', async () => {
    const emptyResult = await engine.review({
      content: '',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(emptyResult.outcome).toBe('PASS');
    
    const specialChars = await engine.review({
      content: '!!! @#$%^&* ()',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(specialChars.outcome).toBe('PASS');
  });
});