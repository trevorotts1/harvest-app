// R-08 (refinements catalog 2026-07-28) — i18n for the new sponsor-pool copy. Mirrors
// tests/unit/r01-pairing-i18n.test.ts's method: each new key exists in BOTH catalogs, and the ES
// leaf is genuinely different text from its EN counterpart (never a copy-paste placeholder). The
// global structural-parity invariant is already enforced by tests/unit/i18n-catalog.test.ts.

import en from '@/lib/i18n/messages/en.json';
import es from '@/lib/i18n/messages/es.json';

type Tree = { [k: string]: string | Tree };

const R08_KEYS = [
  'onboarding.sponsor.loadingPool',
  'onboarding.sponsor.poolErrorTitle',
  'onboarding.sponsor.poolErrorBody',
  'onboarding.sponsor.poolRetryCta',
  'onboarding.sponsor.submittingStatus',
] as const;

function get(tree: Tree, path: string): string | undefined {
  return path.split('.').reduce<Tree | string | undefined>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as Tree)[part];
  }, tree) as string | undefined;
}

describe('R-08 — sponsor-pool copy exists in both catalogs with REAL (non-identical) ES', () => {
  test('every R-08 key is present in BOTH en.json and es.json', () => {
    for (const key of R08_KEYS) {
      expect(get(en as Tree, key)).toBeDefined();
      expect(get(es as Tree, key)).toBeDefined();
    }
  });

  test('every R-08 ES value is genuinely different text from its EN counterpart', () => {
    for (const key of R08_KEYS) {
      expect(get(es as Tree, key)).not.toBe(get(en as Tree, key));
    }
  });

  test('the EN loading copy announces the real pool resolution (never a dead-end)', () => {
    const loading = get(en as Tree, 'onboarding.sponsor.loadingPool') ?? '';
    expect(loading.toLowerCase()).toContain('sponsor');
  });

  test('the EN retry copy offers a real retry affordance', () => {
    const retry = get(en as Tree, 'onboarding.sponsor.poolRetryCta') ?? '';
    expect(retry.toLowerCase()).toContain('try');
  });
});
