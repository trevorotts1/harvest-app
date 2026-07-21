/**
 * T-53 — growth-tolerance statistics (master-spec §17.5; uiux §6.2 "Spanish runs ~25% longer —
 * every component must survive +35% string growth without truncation").
 *
 * This module computes the ACTUAL character-length growth of the shipped ES catalog relative to
 * EN, per key and in aggregate. It is the data half of the growth-tolerance proof: `tests/unit/
 * i18n-growth.test.ts` asserts the real catalog's aggregate growth sits in the expected band, and
 * that no single translated string blows so far past +35% that a fixed-width/no-wrap layout would
 * be caught by surprise. It does not (and cannot, without a real browser) measure rendered pixel
 * overflow — see `scripts/guard-i18n.mjs`'s CSS-level static check for the complementary layout
 * half of this requirement.
 */
import { flattenCatalog, CATALOGS, type CatalogTree } from './catalog';

export interface KeyGrowth {
  key: string;
  en: string;
  es: string;
  ratio: number; // es.length / en.length
}

export interface GrowthReport {
  perKey: KeyGrowth[];
  /** Aggregate ratio across every key's TOTAL character count (not an average of ratios — a
   *  character-weighted mean, which is the honest way to summarize "how much longer is the whole
   *  catalog", immune to a handful of tiny keys skewing a simple average). */
  aggregateRatio: number;
  /** The single largest per-key ratio — the string most likely to overflow a tight container. */
  maxRatio: number;
  maxRatioKey: string | null;
}

/** Computes EN→ES growth for two flattened catalogs (or the real shipped ones by default). Keys
 *  present in only one side are skipped — this measures TRANSLATION growth, not catalog coverage
 *  (coverage is `t()`'s own fallback-to-EN behavior + the "missing key" warning, not this report's
 *  job). */
export function computeGrowthReport(
  enTree: CatalogTree = CATALOGS.en,
  esTree: CatalogTree = CATALOGS.es
): GrowthReport {
  const en = flattenCatalog(enTree);
  const es = flattenCatalog(esTree);

  const perKey: KeyGrowth[] = [];
  let totalEnChars = 0;
  let totalEsChars = 0;
  let maxRatio = 0;
  let maxRatioKey: string | null = null;

  for (const [key, enValue] of Object.entries(en)) {
    const esValue = es[key];
    if (esValue === undefined || enValue.length === 0) continue;
    const ratio = esValue.length / enValue.length;
    perKey.push({ key, en: enValue, es: esValue, ratio });
    totalEnChars += enValue.length;
    totalEsChars += esValue.length;
    if (ratio > maxRatio) {
      maxRatio = ratio;
      maxRatioKey = key;
    }
  }

  return {
    perKey,
    aggregateRatio: totalEnChars > 0 ? totalEsChars / totalEnChars : 1,
    maxRatio,
    maxRatioKey,
  };
}
