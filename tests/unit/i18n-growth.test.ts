// T-53 — growth-tolerance (master-spec §17.5; uiux §6.2 "Spanish runs ~25% longer — every
// component must survive +35% string growth without truncation"). Proves, against the REAL shipped
// catalog, that the aggregate EN->ES growth sits in the expected band, and separately proves the
// growth-computation logic itself flags a synthetic string that blows far past +35%.
import { computeGrowthReport } from '@/lib/i18n/growth';
import type { CatalogTree } from '@/lib/i18n/catalog';

describe('computeGrowthReport — the real shipped EN/ES catalog', () => {
  const report = computeGrowthReport();

  test('every catalog key was measured (structural sanity — not a vacuous 0-key report)', () => {
    expect(report.perKey.length).toBeGreaterThan(50);
  });

  test('aggregate growth is REAL translation (not a byte-identical passthrough) and in a plausible band', () => {
    // uiux §6.2: "~25% longer" typical, "+35%" the tolerance ceiling components must survive. The
    // real catalog should land near/around that band in aggregate — comfortably above 1.0 (proving
    // these are genuine, longer Spanish translations) and not wildly beyond what any component
    // could plausibly need to tolerate.
    expect(report.aggregateRatio).toBeGreaterThan(1.05);
    expect(report.aggregateRatio).toBeLessThan(1.6);
  });

  test('no PROSE-length key (EN >= 15 chars — paragraph/banner copy, at real wrap/overflow risk) blows past 2x growth', () => {
    // A RATIO cap on every key (including tiny chip/button labels like "Retry" -> "Reintentar",
    // 5->10 chars) would be the wrong invariant here: a 4-letter label going to 9 letters is a
    // 2.25x RATIO but a 5-CHARACTER absolute delta — invisible to an inline-flex, auto-width,
    // flex-wrap chip (see the CSS audit in scripts/guard-i18n.mjs and this repo's existing chip/
    // button CSS, which uses exactly that pattern). Ratio is the meaningful risk signal only once a
    // string is long enough to actually occupy layout width — hence the >= 15-char EN floor.
    const proseKeys = report.perKey.filter((k) => k.en.length >= 15);
    expect(proseKeys.length).toBeGreaterThan(20); // sanity: most of the catalog IS prose-length
    const worst = proseKeys.reduce((m, k) => Math.max(m, k.ratio), 0);
    expect(worst).toBeLessThan(2.0);
  });

  test('short (chip/button-length, EN < 15 chars) labels stay within a bounded ABSOLUTE character delta', () => {
    // The complementary check for short labels: ratio is noisy at this length, but the ABSOLUTE
    // number of extra characters an inline-flex chip/button has to accommodate is the real signal,
    // and it stays small — e.g. "Held" -> "Retenidos" is +5 chars, "Retry" -> "Reintentar" is +5.
    const shortKeys = report.perKey.filter((k) => k.en.length < 15);
    const maxDelta = shortKeys.reduce((m, k) => Math.max(m, k.es.length - k.en.length), 0);
    expect(maxDelta).toBeLessThan(15);
  });

  test('report identifies WHICH key has the largest growth (actionable, not just a number)', () => {
    expect(report.maxRatioKey).not.toBeNull();
    const found = report.perKey.find((k) => k.key === report.maxRatioKey);
    expect(found).toBeDefined();
    expect(found!.ratio).toBe(report.maxRatio);
  });
});

describe('computeGrowthReport — synthetic fixtures (proves the MATH, not just the real data)', () => {
  test('a uniform +40% growth catalog reports aggregateRatio == 1.4 exactly', () => {
    const en: CatalogTree = { a: 'x'.repeat(10), b: 'x'.repeat(20) };
    const es: CatalogTree = { a: 'x'.repeat(14), b: 'x'.repeat(28) }; // both exactly +40%
    const report = computeGrowthReport(en, es);
    expect(report.aggregateRatio).toBeCloseTo(1.4, 10);
    expect(report.maxRatio).toBeCloseTo(1.4, 10);
  });

  test('a string that grows 3x is correctly flagged as the max-ratio outlier', () => {
    const en: CatalogTree = { short: 'Hi', normal: '0123456789' };
    const es: CatalogTree = { short: 'HiHiHiHi' /* 4x */, normal: '01234567891234' /* 1.4x */ };
    const report = computeGrowthReport(en, es);
    expect(report.maxRatioKey).toBe('short');
    expect(report.maxRatio).toBe(4);
  });

  test('a key present only in EN (translation gap) is skipped, not treated as 0 growth or a crash', () => {
    const en: CatalogTree = { onlyEn: 'hello', both: 'hi' };
    const es: CatalogTree = { both: 'hola' };
    const report = computeGrowthReport(en, es);
    expect(report.perKey.map((k) => k.key)).toEqual(['both']);
  });

  test('nested keys are measured with their full dotted path', () => {
    const en: CatalogTree = { a: { b: { c: '0123456789' } } };
    const es: CatalogTree = { a: { b: { c: '012345678901234' } } }; // +50%
    const report = computeGrowthReport(en, es);
    expect(report.perKey[0].key).toBe('a.b.c');
    expect(report.perKey[0].ratio).toBeCloseTo(1.5, 5);
  });

  test('an empty catalog pair reports a neutral 1.0 ratio, never NaN/Infinity/division-by-zero', () => {
    const report = computeGrowthReport({}, {});
    expect(report.aggregateRatio).toBe(1);
    expect(Number.isFinite(report.aggregateRatio)).toBe(true);
    expect(report.maxRatio).toBe(0);
    expect(report.maxRatioKey).toBeNull();
  });
});
