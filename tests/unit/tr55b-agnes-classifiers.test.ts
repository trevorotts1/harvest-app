// T-R55b — the three remaining Anthropic classifier/conversation clients converted to Agnes
// (`agnes-2.0-flash`), per OPERATOR DIRECTIVE (2026-07-27): "Use my Agnes AI API key for anything
// where Anthropic was used previously" (see harvest-changelog.md's T-R55 entry; T-R55 itself already
// converted the agent-generation path — this unit finishes the classifier/conversation paths).
//
// Proves, for each of AgnesConversationClient (Seven Whys), AgnesSegmentationClient (warm-market
// segmentation), and AgnesMemoryJoggerCategoryClient (Memory Jogger):
//   (a) it routes to the Agnes chat/completions endpoint with model `agnes-2.0-flash`;
//   (b) the SAFETY property is preserved unchanged from the retained-but-unused Anthropic sibling —
//       missing key / non-OK / timeout / unparseable / a degenerate ("null") JSON body / an
//       out-of-contract enum value all FAIL CLOSED (throw the SAME domain error classes the
//       Anthropic sibling threw), never a fabricated result, never a fallback to a different
//       provider.
import {
  AgnesConversationClient,
  MissingClaudeCredentialError as SevenWhysMissingCredentialError,
  SevenWhysConversationError,
  SevenWhysLevel,
  SevenWhysTimeoutError,
} from '../../src/services/onboarding/wp01/seven-whys';
import {
  AgnesSegmentationClient,
  MissingClaudeCredentialError as SegmentationMissingCredentialError,
  SegmentationError,
  SegmentationTimeoutError,
} from '../../src/services/warm-market/segmentation';
import { RelationshipType } from '../../src/types/warm-market';
import {
  AgnesMemoryJoggerCategoryClient,
  MemoryJoggerCategory,
  MissingClaudeCredentialError as JoggerMissingCredentialError,
  MemoryJoggerCategoryError,
  MemoryJoggerCategoryTimeoutError,
} from '../../src/services/warm-market/memory-jogger';

const KEY = 'AGNES_AI_API_KEY';

function withSavedKey(fn: () => void | Promise<void>) {
  return async () => {
    const prior = process.env[KEY];
    try {
      await fn();
    } finally {
      if (prior === undefined) delete process.env[KEY];
      else process.env[KEY] = prior;
    }
  };
}

function agnesBody(content: string) {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

describe('T-R55b AgnesConversationClient (Seven Whys) — Agnes routing + fail-closed', () => {
  function req() {
    return {
      respondingToLevel: null,
      answer: null,
      nextLevel: SevenWhysLevel.GOAL,
      isDeepening: false,
      transcript: [],
    };
  }

  test(
    'missing AGNES_AI_API_KEY -> MissingClaudeCredentialError BEFORE any network attempt (fail-closed)',
    withSavedKey(async () => {
      delete process.env[KEY];
      let called = false;
      const client = new AgnesConversationClient({
        fetchImpl: (async () => {
          called = true;
          return { ok: true, status: 200, text: async () => agnesBody('{}') };
        }) as never,
      });
      await expect(client.converse(req())).rejects.toBeInstanceOf(SevenWhysMissingCredentialError);
      expect(called).toBe(false);
    })
  );

  test(
    'valid key -> routes to the Agnes endpoint with model agnes-2.0-flash, parses the turn',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      let sentUrl = '';
      let sentBody: Record<string, unknown> = {};
      const client = new AgnesConversationClient({
        fetchImpl: (async (url: string, init: { body: string }) => {
          sentUrl = url;
          sentBody = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            text: async () =>
              agnesBody(
                JSON.stringify({
                  acknowledgment: null,
                  question: 'What matters most to you right now?',
                  depth_signal: 0.4,
                })
              ),
          };
        }) as never,
      });
      const res = await client.converse(req());
      expect(res.question).toBe('What matters most to you right now?');
      expect(res.depthSignal).toBe(0.4);
      expect(sentUrl).toContain('agnes-ai.com');
      expect(sentBody.model).toBe('agnes-2.0-flash');
      expect(Array.isArray(sentBody.messages)).toBe(true);
      expect(sentBody.response_format).toEqual({ type: 'json_object' });
    })
  );

  test(
    'composeAnchor(): valid key -> parses the anchor statement',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesConversationClient({
        fetchImpl: (async () => ({
          ok: true,
          status: 200,
          text: async () => agnesBody(JSON.stringify({ anchor_statement: "I'm building toward stability." })),
        })) as never,
      });
      const res = await client.composeAnchor({ transcript: [] });
      expect(res.anchorStatement).toBe("I'm building toward stability.");
    })
  );

  test(
    'a degenerate ("null") Agnes JSON body throws SevenWhysConversationError, never a raw TypeError',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesConversationClient({
        fetchImpl: (async () => ({ ok: true, status: 200, text: async () => agnesBody('null') })) as never,
      });
      await expect(client.converse(req())).rejects.toThrow(SevenWhysConversationError);
      await expect(client.converse(req())).rejects.toThrow('Agnes conversation turn missing required fields.');
    })
  );

  test(
    'non-OK HTTP status -> SevenWhysConversationError (fail-closed, no fabricated turn)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesConversationClient({
        // enableThinking default true -> one retry; both attempts return 500 -> still throws.
        fetchImpl: (async () => ({ ok: false, status: 500, text: async () => 'upstream error' })) as never,
      });
      await expect(client.converse(req())).rejects.toBeInstanceOf(SevenWhysConversationError);
    })
  );

  test(
    'abort/timeout -> SevenWhysTimeoutError (fail-closed)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesConversationClient({
        fetchImpl: (async () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          throw e;
        }) as never,
      });
      await expect(client.converse(req())).rejects.toBeInstanceOf(SevenWhysTimeoutError);
    })
  );

  test(
    'unparseable body -> SevenWhysConversationError (never a fabricated question)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesConversationClient({
        fetchImpl: (async () => ({ ok: true, status: 200, text: async () => 'not json at all' })) as never,
      });
      await expect(client.converse(req())).rejects.toBeInstanceOf(SevenWhysConversationError);
    })
  );
});

describe('T-R55b AgnesSegmentationClient (warm-market segmentation) — Agnes routing + fail-closed', () => {
  const req = {
    contactId: 'contact-1',
    hints: { notes: 'we play in the same church band', industry: 'Music', groupMembership: null },
  };

  test(
    'missing AGNES_AI_API_KEY -> MissingClaudeCredentialError BEFORE any network attempt (fail-closed)',
    withSavedKey(async () => {
      delete process.env[KEY];
      let called = false;
      const client = new AgnesSegmentationClient({
        fetchImpl: (async () => {
          called = true;
          return { ok: true, status: 200, text: async () => agnesBody('{}') };
        }) as never,
      });
      await expect(client.inferRelationshipType(req)).rejects.toBeInstanceOf(SegmentationMissingCredentialError);
      expect(called).toBe(false);
    })
  );

  test(
    'valid key -> routes to the Agnes endpoint with model agnes-2.0-flash, parses the relationship type',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      let sentUrl = '';
      let sentBody: Record<string, unknown> = {};
      const client = new AgnesSegmentationClient({
        fetchImpl: (async (url: string, init: { body: string }) => {
          sentUrl = url;
          sentBody = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            text: async () =>
              agnesBody(JSON.stringify({ relationship_type: 'CHURCH', confidence: 0.82, rationale: 'church band' })),
          };
        }) as never,
      });
      const res = await client.inferRelationshipType(req);
      expect(res.relationshipType).toBe(RelationshipType.CHURCH);
      expect(res.confidence).toBe(0.82);
      expect(sentUrl).toContain('agnes-ai.com');
      expect(sentBody.model).toBe('agnes-2.0-flash');
      expect(sentBody.response_format).toEqual({ type: 'json_object' });
    })
  );

  test(
    'a degenerate ("null") Agnes JSON body throws SegmentationError, never a raw TypeError',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesSegmentationClient({
        fetchImpl: (async () => ({ ok: true, status: 200, text: async () => agnesBody('null') })) as never,
      });
      await expect(client.inferRelationshipType(req)).rejects.toThrow(SegmentationError);
      await expect(client.inferRelationshipType(req)).rejects.toThrow(
        'Agnes segmentation verdict missing a valid relationship_type.'
      );
    })
  );

  test(
    'an out-of-contract relationship_type value throws SegmentationError (never accepted as-is)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesSegmentationClient({
        fetchImpl: (async () => ({
          ok: true,
          status: 200,
          text: async () => agnesBody(JSON.stringify({ relationship_type: 'NOT_A_REAL_TYPE', confidence: 0.5 })),
        })) as never,
      });
      await expect(client.inferRelationshipType(req)).rejects.toBeInstanceOf(SegmentationError);
    })
  );

  test(
    'non-OK HTTP status -> SegmentationError (fail-closed, no fabricated relationship type)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesSegmentationClient({
        fetchImpl: (async () => ({ ok: false, status: 500, text: async () => 'upstream error' })) as never,
      });
      await expect(client.inferRelationshipType(req)).rejects.toBeInstanceOf(SegmentationError);
    })
  );

  test(
    'abort/timeout -> SegmentationTimeoutError (fail-closed)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesSegmentationClient({
        fetchImpl: (async () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          throw e;
        }) as never,
      });
      await expect(client.inferRelationshipType(req)).rejects.toBeInstanceOf(SegmentationTimeoutError);
    })
  );

  test(
    'unparseable body -> SegmentationError (never a fabricated relationship type)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesSegmentationClient({
        fetchImpl: (async () => ({ ok: true, status: 200, text: async () => 'not json at all' })) as never,
      });
      await expect(client.inferRelationshipType(req)).rejects.toBeInstanceOf(SegmentationError);
    })
  );
});

describe('T-R55b AgnesMemoryJoggerCategoryClient (Memory Jogger) — Agnes routing + fail-closed', () => {
  const req = { recentCategories: [] as MemoryJoggerCategory[] };

  test(
    'missing AGNES_AI_API_KEY -> MissingClaudeCredentialError BEFORE any network attempt (fail-closed)',
    withSavedKey(async () => {
      delete process.env[KEY];
      let called = false;
      const client = new AgnesMemoryJoggerCategoryClient({
        fetchImpl: (async () => {
          called = true;
          return { ok: true, status: 200, text: async () => agnesBody('{}') };
        }) as never,
      });
      await expect(client.selectNextCategory(req)).rejects.toBeInstanceOf(JoggerMissingCredentialError);
      expect(called).toBe(false);
    })
  );

  test(
    'valid key -> routes to the Agnes endpoint with model agnes-2.0-flash, parses the category',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      let sentUrl = '';
      let sentBody: Record<string, unknown> = {};
      const client = new AgnesMemoryJoggerCategoryClient({
        fetchImpl: (async (url: string, init: { body: string }) => {
          sentUrl = url;
          sentBody = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            text: async () =>
              agnesBody(JSON.stringify({ category: 'NEIGHBORS', rationale: 'not shown recently' })),
          };
        }) as never,
      });
      const res = await client.selectNextCategory(req);
      expect(res.category).toBe(MemoryJoggerCategory.NEIGHBORS);
      expect(typeof res.promptText).toBe('string');
      expect(sentUrl).toContain('agnes-ai.com');
      expect(sentBody.model).toBe('agnes-2.0-flash');
      expect(sentBody.response_format).toEqual({ type: 'json_object' });
    })
  );

  test(
    'a degenerate ("null") Agnes JSON body throws MemoryJoggerCategoryError, never a raw TypeError',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesMemoryJoggerCategoryClient({
        fetchImpl: (async () => ({ ok: true, status: 200, text: async () => agnesBody('null') })) as never,
      });
      await expect(client.selectNextCategory(req)).rejects.toThrow(MemoryJoggerCategoryError);
      await expect(client.selectNextCategory(req)).rejects.toThrow(
        'Agnes Memory Jogger verdict missing a valid category.'
      );
    })
  );

  test(
    'an out-of-contract category value throws MemoryJoggerCategoryError (never accepted as-is)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesMemoryJoggerCategoryClient({
        fetchImpl: (async () => ({
          ok: true,
          status: 200,
          text: async () => agnesBody(JSON.stringify({ category: 'NOT_A_REAL_CATEGORY', rationale: 'x' })),
        })) as never,
      });
      await expect(client.selectNextCategory(req)).rejects.toBeInstanceOf(MemoryJoggerCategoryError);
    })
  );

  test(
    'non-OK HTTP status -> MemoryJoggerCategoryError (fail-closed, no fabricated category)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesMemoryJoggerCategoryClient({
        fetchImpl: (async () => ({ ok: false, status: 500, text: async () => 'upstream error' })) as never,
      });
      await expect(client.selectNextCategory(req)).rejects.toBeInstanceOf(MemoryJoggerCategoryError);
    })
  );

  test(
    'abort/timeout -> MemoryJoggerCategoryTimeoutError (fail-closed)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesMemoryJoggerCategoryClient({
        fetchImpl: (async () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          throw e;
        }) as never,
      });
      await expect(client.selectNextCategory(req)).rejects.toBeInstanceOf(MemoryJoggerCategoryTimeoutError);
    })
  );

  test(
    'unparseable body -> MemoryJoggerCategoryError (never a fabricated category)',
    withSavedKey(async () => {
      process.env[KEY] = 'test-agnes-key';
      const client = new AgnesMemoryJoggerCategoryClient({
        fetchImpl: (async () => ({ ok: true, status: 200, text: async () => 'not json at all' })) as never,
      });
      await expect(client.selectNextCategory(req)).rejects.toBeInstanceOf(MemoryJoggerCategoryError);
    })
  );
});
