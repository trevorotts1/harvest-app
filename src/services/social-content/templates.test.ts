import { CONTENT_TEMPLATES, ensureTemplatesSeeded, personalizationTierForTemplate } from './templates';
import { scanVocabulary } from './doctrine-guard';

describe('CONTENT_TEMPLATES — §11.6 "20+ doctrine-verified templates"', () => {
  test('ships at least 20 templates', () => {
    expect(CONTENT_TEMPLATES.length).toBeGreaterThanOrEqual(20);
  });

  test('every template key is unique', () => {
    const keys = CONTENT_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('every one of the five weekly-batch categories is represented', () => {
    const categories = new Set(CONTENT_TEMPLATES.map((t) => t.category).filter(Boolean));
    expect(categories).toEqual(
      new Set(['COMMUNITY_SPOTLIGHT', 'VALUE_FIRST_EDUCATION', 'MOVEMENT_FRAMING', 'BEHIND_THE_HARVEST', 'EVENT_INTRODUCTION_ANNOUNCEMENT'])
    );
  });

  test('the Harvest book integration is explicitly represented (§11.6)', () => {
    const bookTemplates = CONTENT_TEMPLATES.filter((t) => t.key.includes('harvest-book'));
    expect(bookTemplates.length).toBeGreaterThanOrEqual(2);
  });

  test('all four launch-kit piece types have a template', () => {
    const pieces = new Set(CONTENT_TEMPLATES.map((t) => t.launchKitPieceType).filter(Boolean));
    expect(pieces).toEqual(new Set(['WELCOME', 'ANNOUNCEMENT', 'DAY3_VALUE_EMAIL', 'DAY7_EVENT_INVITE']));
  });

  test('no template copy skeleton itself contains a forbidden doctrine term (a read-confirmed check, not a bare grep verdict — this asserts the SAME classifier the CFE/queue path uses)', () => {
    for (const t of CONTENT_TEMPLATES) {
      const scan = scanVocabulary(t.copySkeleton);
      expect({ key: t.key, clean: scan.clean, violations: scan.violations }).toEqual({ key: t.key, clean: true, violations: [] });
    }
  });

  test('three personalization tiers are all represented across the catalog', () => {
    const tiers = new Set(CONTENT_TEMPLATES.map((t) => personalizationTierForTemplate(t.key)));
    expect(tiers).toEqual(new Set(['AUTOMATIC', 'AI_INFERRED', 'REP_PROVIDED']));
  });
});

describe('ensureTemplatesSeeded — idempotent DB-mirror upsert', () => {
  test('upserts every catalog template exactly once by key', async () => {
    const upsertCalls: { where: { key: string } }[] = [];
    const fakeDb = {
      contentTemplate: {
        upsert: jest.fn().mockImplementation(async (args: { where: { key: string } }) => {
          upsertCalls.push(args);
          return {};
        }),
      },
    };
    await ensureTemplatesSeeded(fakeDb);
    expect(upsertCalls.length).toBe(CONTENT_TEMPLATES.length);
    const keys = upsertCalls.map((c) => c.where.key);
    expect(new Set(keys).size).toBe(CONTENT_TEMPLATES.length);
  });
});
