import { ComplianceFilterEngine } from '../../src/services/compliance/engine';

describe('ComplianceFilterEngine', () => {
  const engine = new ComplianceFilterEngine();

  test('should block content with forbidden terms', async () => {
    const result = await engine.review({
      content: 'Make guaranteed income today!',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(result.outcome).toBe('BLOCK');
  });

  test('should pass safe content', async () => {
    const result = await engine.review({
      content: 'Hey, want to grab coffee?',
      channel: 'SMS',
      userContext: { user_id: '123', role: 'REP' }
    });
    expect(result.outcome).toBe('PASS');
  });
});
