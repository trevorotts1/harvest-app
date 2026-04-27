import { ComplianceFilterEngine } from '../../src/services/compliance/engine';

describe('ComplianceFilterEngine', () => {
  const engine = new ComplianceFilterEngine();

  test('should block content with high risk (BLOCK)', () => {
    const result = engine.review({
      content: 'Make guaranteed income today! Earn so much money!',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    if (result.outcome === 'FLAG' || result.outcome === 'BLOCK') {
      console.log('Result:', result);
    }
    expect(result.outcome).toBe('BLOCK');
  });

  test('should flag content with medium risk (FLAG)', () => {
    // Only moderate use of "opportunity"
    const result = engine.review({
      content: 'I have an opportunity for you.',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(result.outcome).toBe('FLAG');
    expect(result.risk_score).toBeGreaterThan(10);
    expect(result.risk_score).toBeLessThanOrEqual(70);
  });

  test('should pass safe content (PASS)', () => {
    const result = engine.review({
      content: 'Hey, want to grab coffee?',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(result.outcome).toBe('PASS');
    expect(result.classifier_data.INCOME_CLAIM).toBe(0);
  });

  test('should calculate real classifier scores', () => {
    const result = engine.review({
      content: 'I love my life insurance policy! It has great coverage.',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(result.classifier_data.INSURANCE).toBeGreaterThan(0);
  });

  test('should handle edge cases', () => {
    const emptyResult = engine.review({
      content: '',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(emptyResult.outcome).toBe('PASS');
    
    const specialChars = engine.review({
      content: '!!! @#$%^&* ()',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(specialChars.outcome).toBe('PASS');
  });

  test('should invoke audit callback', () => {
    const onDecision = jest.fn();
    const engineWithAudit = new ComplianceFilterEngine({ onDecision });
    
    engineWithAudit.review({
      content: 'Hey!',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    
    expect(onDecision).toHaveBeenCalled();
  });
});