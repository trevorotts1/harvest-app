import {
  generateDoctrineCleanDraft,
  parseBlogResponse,
  parseEmailResponse,
  parseSocialPostResponse,
  runDoctrineChecks,
} from './content-generation';
import type { AgentModelClient, AgentGenerationRequest } from '@/services/agent-runtime/claude';
import { ClaudeModelTier } from '@/services/agent-runtime/runtime-model-map';
import type { ToneGateClassifierClient, ToneGateVerdict } from './doctrine-guard';

function cleanTone(): ToneGateClassifierClient {
  return {
    classify: jest.fn().mockResolvedValue({
      clean: true,
      leadsWithRelationship: true,
      treatsAudienceAsCommunity: true,
      reinforcesThreeLaws: true,
      harvestHoarderFraming: false,
      rationale: 'clean',
    } as ToneGateVerdict),
  };
}

function sequencedClient(texts: string[]): AgentModelClient {
  let call = 0;
  return {
    generate: jest.fn().mockImplementation(async (req: AgentGenerationRequest) => ({
      text: texts[Math.min(call++, texts.length - 1)],
      modelId: req.tier === ClaudeModelTier.SONNET_5 ? 'claude-sonnet-5' : 'claude-haiku-4-5-20251001',
      tier: req.tier,
      tokenInput: 20,
      tokenOutput: 40,
      batched: false,
    })),
  };
}

describe('generateDoctrineCleanDraft — the regenerate-on-violation loop (§11.2 layers 1-2)', () => {
  test('returns clean on the first attempt when the draft is already doctrine-clean', async () => {
    const client = sequencedClient(['A warm story about a community member.\nIMAGE CONCEPT: a natural photo.']);
    const result = await generateDoctrineCleanDraft(
      { systemPrompt: 'sys', userPrompt: 'user', parse: parseSocialPostResponse },
      { modelClient: client, toneGate: cleanTone() }
    );
    expect(result.vocabClean).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.body).toContain('community member');
    expect(result.imageConceptPrompt).toContain('natural photo');
    expect(client.generate).toHaveBeenCalledTimes(1);
    expect((client.generate as jest.Mock).mock.calls[0][0].tier).toBe(ClaudeModelTier.SONNET_5);
  });

  test('regenerates once on a forbidden-term violation, then succeeds', async () => {
    const client = sequencedClient([
      'This prospect is a great lead for my funnel.',
      'I introduced a wonderful community member to our base this week.',
    ]);
    const result = await generateDoctrineCleanDraft(
      { systemPrompt: 'sys', userPrompt: 'user', parse: (raw) => ({ body: raw }) },
      { modelClient: client, toneGate: cleanTone() }
    );
    expect(result.vocabClean).toBe(true);
    expect(result.attempts).toBe(2);
    expect(client.generate).toHaveBeenCalledTimes(2);
    // The second call's user prompt must carry the violation feedback.
    const secondCallPrompt = (client.generate as jest.Mock).mock.calls[1][0].userPrompt;
    expect(secondCallPrompt).toMatch(/violated doctrine/i);
  });

  test('still dirty after maxAttempts returns vocabClean=false with doctrineNotes (never silently released)', async () => {
    const client = sequencedClient(['This prospect is a lead.', 'Another lead for my funnel.']);
    const result = await generateDoctrineCleanDraft(
      { systemPrompt: 'sys', userPrompt: 'user', parse: (raw) => ({ body: raw }), maxAttempts: 2 },
      { modelClient: client, toneGate: cleanTone() }
    );
    expect(result.vocabClean).toBe(false);
    expect(result.doctrineNotes.length).toBeGreaterThan(0);
    expect(result.attempts).toBe(2);
  });

  test('fail-closed: a tone-gate classifier failure propagates and is not swallowed', async () => {
    const client = sequencedClient(['A clean, community-first story.']);
    const throwingTone: ToneGateClassifierClient = { classify: jest.fn().mockRejectedValue(new Error('Claude unavailable')) };
    await expect(
      generateDoctrineCleanDraft({ systemPrompt: 'sys', userPrompt: 'user', parse: (raw) => ({ body: raw }) }, { modelClient: client, toneGate: throwingTone })
    ).rejects.toThrow('Claude unavailable');
  });
});

describe('runDoctrineChecks — composes vocabulary + anti-pattern + tone-gate scans', () => {
  test('a harvest-hoarder-flagged tone verdict makes the whole check dirty even with clean vocabulary', async () => {
    const hoarderTone: ToneGateClassifierClient = {
      classify: jest.fn().mockResolvedValue({
        clean: false,
        leadsWithRelationship: true,
        treatsAudienceAsCommunity: false,
        reinforcesThreeLaws: false,
        harvestHoarderFraming: true,
        rationale: 'singular success framing',
      } as ToneGateVerdict),
    };
    const result = await runDoctrineChecks('I built this entire business myself and nobody helped.', hoarderTone);
    expect(result.clean).toBe(false);
    expect(result.reasons.some((r) => /Harvest-Hoarder/.test(r))).toBe(true);
  });
});

describe('response parsers', () => {
  test('parseSocialPostResponse splits body from the IMAGE CONCEPT line', () => {
    const parsed = parseSocialPostResponse('Body text here.\nIMAGE CONCEPT: a natural harvest field.');
    expect(parsed.body).toBe('Body text here.');
    expect(parsed.imageConceptPrompt).toBe('a natural harvest field.');
  });

  test('parseBlogResponse takes the first line as headline', () => {
    const parsed = parseBlogResponse('My Blog Headline\nThe rest of the blog body.');
    expect(parsed.headline).toBe('My Blog Headline');
    expect(parsed.body).toBe('The rest of the blog body.');
  });

  test('parseEmailResponse extracts SUBJECT: as headline', () => {
    const parsed = parseEmailResponse('SUBJECT: A warm welcome\nHello there, welcome to our community.');
    expect(parsed.headline).toBe('A warm welcome');
    expect(parsed.body).toContain('Hello there');
  });
});
