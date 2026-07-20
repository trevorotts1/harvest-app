// T-43 (WP07 §12.8 P1, §12.9-9) — Ask Harvest: grounded exclusively in course/objection/doctrine
// sources; clearly labeled coaching; refuses out-of-scope questions WITHOUT ever calling the model
// (the QC break-it case: "ask Ask-Harvest an out-of-scope question and confirm it refuses to answer
// from outside its sources").

import { askHarvest, isInScope } from '../../src/services/gamification/ask-harvest.service';
import type { AgentModelClient } from '../../src/services/agent-runtime/claude/runtime-client';

describe('isInScope — deterministic scope gate', () => {
  test('an in-scope question (matches a real objection) is in scope', () => {
    expect(isInScope('What do I say about the pyramid scheme objection?')).toBe(true);
  });
  test('an in-scope question (matches a real course module) is in scope', () => {
    expect(isInScope('Can you remind me about the three laws?')).toBe(true);
  });
  test('an out-of-scope question (unrelated to Harvest at all) is NOT in scope', () => {
    expect(isInScope('What stock should I buy this week?')).toBe(false);
    expect(isInScope('What is the weather like tomorrow?')).toBe(false);
    expect(isInScope('Give me legal advice about my divorce.')).toBe(false);
  });
});

describe('askHarvest — refuses out-of-scope questions WITHOUT calling the model', () => {
  test('an out-of-scope question never reaches the model client', async () => {
    let called = false;
    const modelClient: AgentModelClient = {
      async generate() {
        called = true;
        return { text: 'anything', modelId: 'claude-sonnet-5', tier: 'sonnet_5' as never, tokenInput: 0, tokenOutput: 0, batched: false };
      },
    };
    const result = await askHarvest('What lottery numbers should I play?', { modelClient });
    expect(called).toBe(false);
    expect(result.status).toBe('refused');
    expect(result.label).toBe('coaching');
    expect(result.answer).not.toBeNull();
    expect(result.answer!.length).toBeGreaterThan(0);
  });

  test('an in-scope question calls the model and returns labeled coaching', async () => {
    const modelClient: AgentModelClient = {
      async generate() {
        return { text: 'Try the clarifying question first, then walk through the branch.', modelId: 'claude-sonnet-5', tier: 'sonnet_5' as never, tokenInput: 10, tokenOutput: 10, batched: false };
      },
    };
    const result = await askHarvest('What do I say about the pyramid scheme objection?', { modelClient });
    expect(result.status).toBe('ok');
    expect(result.label).toBe('coaching');
    expect(result.answer).toContain('clarifying question');
  });

  test('Claude unavailable for an in-scope question → held, never a fabricated answer', async () => {
    const modelClient: AgentModelClient = { async generate() { throw new Error('MissingClaudeCredentialError'); } };
    const result = await askHarvest('What do I say about the pyramid scheme objection?', { modelClient });
    expect(result.status).toBe('held');
    expect(result.answer).toBeNull();
  });
});
