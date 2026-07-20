import {
  detectMassPersonalization,
  HaikuToneGateClassifier,
  scanDeterministicAntiPatterns,
  scanRecruitFraming,
  scanVocabulary,
} from './doctrine-guard';
import type { AgentModelClient } from '@/services/agent-runtime/claude';
import { ClaudeModelTier } from '@/services/agent-runtime/runtime-model-map';

describe('scanVocabulary — reuses the compliance module\'s own forbidden-term table', () => {
  test('flags a forbidden term', () => {
    const result = scanVocabulary('This prospect is a great lead for my funnel.');
    expect(result.clean).toBe(false);
    expect(result.violations.map((v) => v.forbidden)).toEqual(expect.arrayContaining(['prospect', 'lead', 'funnel']));
  });

  test('clean doctrine-safe text passes', () => {
    const result = scanVocabulary('I introduced a community member to our base this week.');
    expect(result.clean).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test('blocks "follower" framing', () => {
    const result = scanVocabulary('We are so proud of our new followers!');
    expect(result.clean).toBe(false);
    expect(result.violations[0].forbidden).toBe('follower');
  });
});

describe('scanDeterministicAntiPatterns — WP06-specific anti-patterns (§11.2/§11.7)', () => {
  test('flags vanity-metric growth bragging', () => {
    const result = scanDeterministicAntiPatterns('We just hit 1,000 members this month!');
    expect(result.clean).toBe(false);
    expect(result.violations[0].kind).toBe('vanity_metric');
  });

  test('flags false scarcity', () => {
    const result = scanDeterministicAntiPatterns('Only 3 spots left — act now!');
    expect(result.clean).toBe(false);
    expect(result.violations.map((v) => v.kind)).toContain('false_scarcity');
  });

  test('flags a leftover mail-merge template token', () => {
    const result = scanDeterministicAntiPatterns('Hi {{name}}, join my team and earn $500!');
    expect(result.clean).toBe(false);
    expect(result.violations.map((v) => v.kind)).toEqual(expect.arrayContaining(['template_token_leftover', 'extraction_framing']));
  });

  test('clean, specific, written-for-one-reader text passes', () => {
    const result = scanDeterministicAntiPatterns('I wanted to share something that helped me this week.');
    expect(result.clean).toBe(true);
  });
});

describe('scanRecruitFraming — §11.4/critical-failure "new member framed as recruit/sign-up"', () => {
  test('flags "our newest sign-up"', () => {
    const result = scanRecruitFraming('Meet our newest sign-up, Jordan!');
    expect(result.clean).toBe(false);
  });

  test('flags "new recruit"', () => {
    const result = scanRecruitFraming('Welcome our new recruit to the team.');
    expect(result.clean).toBe(false);
  });

  test('does NOT flag a legitimate event RSVP ask (no false positive)', () => {
    const result = scanRecruitFraming('Sign up for our community event this Saturday!');
    expect(result.clean).toBe(true);
  });

  test('clean welcome text passes', () => {
    const result = scanRecruitFraming('Welcome Jordan to the community — so glad you joined!');
    expect(result.clean).toBe(true);
  });
});

describe('detectMassPersonalization — batch-level cold-pitch/mail-merge detection (§11.7, AC-6)', () => {
  test('flags two structurally-identical bodies (mail-merge name-swap)', () => {
    const bodies = [
      'Hi Sarah, join my team and change your life with this incredible opportunity today!',
      'Hi Marcus, join my team and change your life with this incredible opportunity today!',
    ];
    const result = detectMassPersonalization(bodies);
    expect(result.clean).toBe(false);
    expect(result.duplicatePairs).toEqual([[0, 1]]);
  });

  test('does not flag genuinely distinct, differently-structured posts', () => {
    const bodies = [
      'Spotlight on Maria this week — her story about finding this community after a hard year really stuck with me.',
      'One idea that changed how I think about budgeting: pay yourself first, always, before anything else.',
      'This is part of something bigger than any one of us — Grow the Downline, Engage the Base, Increase Wealth.',
    ];
    const result = detectMassPersonalization(bodies);
    expect(result.clean).toBe(true);
  });
});

describe('HaikuToneGateClassifier — the three-question tone gate + Harvest-Hoarder detection', () => {
  function fakeClient(responseText: string): AgentModelClient {
    return {
      generate: jest.fn().mockResolvedValue({
        text: responseText,
        modelId: 'claude-haiku-4-5-20251001',
        tier: ClaudeModelTier.HAIKU_4_5,
        tokenInput: 10,
        tokenOutput: 10,
        batched: false,
      }),
    };
  }

  test('calls Haiku 4.5 and parses a clean verdict', async () => {
    const client = fakeClient(
      JSON.stringify({
        leads_with_relationship: true,
        treats_audience_as_community: true,
        reinforces_three_laws: true,
        harvest_hoarder_framing: false,
        rationale: 'Warm, community-centered.',
      })
    );
    const classifier = new HaikuToneGateClassifier(client);
    const verdict = await classifier.classify('A warm community story.');
    expect(verdict.clean).toBe(true);
    expect((client.generate as jest.Mock).mock.calls[0][0].tier).toBe(ClaudeModelTier.HAIKU_4_5);
  });

  test('flags Harvest-Hoarder framing (rep as singular success)', async () => {
    const client = fakeClient(
      JSON.stringify({
        leads_with_relationship: true,
        treats_audience_as_community: false,
        reinforces_three_laws: false,
        harvest_hoarder_framing: true,
        rationale: 'No base acknowledgment; frames rep as sole success.',
      })
    );
    const classifier = new HaikuToneGateClassifier(client);
    const verdict = await classifier.classify('I did this all myself and I am unstoppable.');
    expect(verdict.clean).toBe(false);
    expect(verdict.harvestHoarderFraming).toBe(true);
  });

  test('fail-closed: a transport error propagates (is not swallowed)', async () => {
    const client: AgentModelClient = { generate: jest.fn().mockRejectedValue(new Error('transport down')) };
    const classifier = new HaikuToneGateClassifier(client);
    await expect(classifier.classify('anything')).rejects.toThrow('transport down');
  });

  test('fail-closed: a malformed (non-JSON) verdict throws rather than defaulting clean', async () => {
    const client = fakeClient('not json at all');
    const classifier = new HaikuToneGateClassifier(client);
    await expect(classifier.classify('anything')).rejects.toThrow(/valid JSON/);
  });
});
