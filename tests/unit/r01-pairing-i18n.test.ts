// R-01 (refinements catalog 2026-07-28) — i18n for the RVP no-pairing copy. Mirrors
// tests/unit/admin-console-catalog-parity.test.ts's method for the NEW R-01 keys: each key exists
// in BOTH catalogs, and the ES leaf is genuinely different text from its EN counterpart (never a
// copy-paste placeholder). The global structural-parity invariant is already enforced by
// tests/unit/i18n-catalog.test.ts; this suite proves the R-01 additions specifically.
//
// LANGUAGE-NEUTRAL EXEMPT: "RVP"/"SVP" are platform role abbreviations, never translated in
// either language (same convention as admin-console-catalog-parity.test.ts's own
// LANGUAGE_NEUTRAL_EXEMPT for "RVP").

import en from '@/lib/i18n/messages/en.json';
import es from '@/lib/i18n/messages/es.json';

type Tree = { [k: string]: string | Tree };

const R01_KEYS = [
  'auth.primerica.rvpNoPairingBody',
  'auth.primerica.rvpUplineOptional',
  'onboarding.sponsor.rvpNoPairingHeadline',
  'onboarding.sponsor.rvpNoPairingBody',
  'onboarding.sponsor.rvpUplineOptional',
] as const;

function get(tree: Tree, path: string): string | undefined {
  return path.split('.').reduce<Tree | string | undefined>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as Tree)[part];
  }, tree) as string | undefined;
}

describe('R-01 — RVP no-pairing copy exists in both catalogs with REAL (non-identical) ES', () => {
  test('every R-01 key is present in BOTH en.json and es.json', () => {
    for (const key of R01_KEYS) {
      expect(get(en as Tree, key)).toBeDefined();
      expect(get(es as Tree, key)).toBeDefined();
    }
  });

  test('every R-01 ES value is genuinely different text from its EN counterpart', () => {
    for (const key of R01_KEYS) {
      expect(get(es as Tree, key)).not.toBe(get(en as Tree, key));
    }
  });

  test('the EN copy states the R-01 rule plainly: not paired, upline optional, never supervises', () => {
    const body = get(en as Tree, 'auth.primerica.rvpNoPairingBody') ?? '';
    expect(body.toLowerCase()).toContain('not being paired');
    const optional = get(en as Tree, 'auth.primerica.rvpUplineOptional') ?? '';
    expect(optional.toLowerCase()).toContain('optional');
    expect(optional.toLowerCase()).toContain('svp');
  });
});
