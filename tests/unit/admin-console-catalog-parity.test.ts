// T-R56 (admin console) — catalog parity + REAL Spanish for the new `admin.*` namespace this
// build unit adds. Mirrors tests/unit/t57-r3c1-catalog-parity.test.ts's exact method: (1) the
// namespace exists in both catalogs, (2) every leaf key has EXACT parity (same key set) between
// EN and ES, (3) every ES leaf is genuinely different text from its EN counterpart (never a
// copy-paste placeholder). The doctrine-vocabulary/growth-tolerance half is covered end-to-end by
// `npm run guard:i18n`; this test's job is parity + non-identity for THIS namespace specifically.

import en from '@/lib/i18n/messages/en.json';
import es from '@/lib/i18n/messages/es.json';

type Tree = { [k: string]: string | Tree };

function get(tree: Tree, path: string): string | Tree | undefined {
  return path.split('.').reduce<string | Tree | undefined>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as Tree)[part];
  }, tree);
}

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[p] = v;
    else out[p] = '';
    if (typeof v === 'object' && v !== null) Object.assign(out, flatten(v, p));
  }
  return out;
}

// Genuinely language-neutral by deliberate choice (mirrors t57-r3c1-catalog-parity.test.ts's own
// `LANGUAGE_NEUTRAL_EXEMPT` convention):
//   - "RVP" is the platform's own role-name abbreviation, never translated in either language
//     (same as ADMIN's own rbac-matrix.ts / uiux comments write it).
//   - `admin.users.detailHeading` is the bare interpolation placeholder `"{name}"` with NO
//     surrounding words in either language (the user's own name supplies 100% of the rendered
//     text) — there is no English word present to leave untranslated.
const LANGUAGE_NEUTRAL_EXEMPT = new Set(['admin.role.rvp', 'admin.users.detailHeading']);

describe('T-R56 — admin.* catalog: exists in both, full parity, real (non-identical) ES', () => {
  test('namespace "admin" exists in BOTH en.json and es.json', () => {
    expect(get(en as Tree, 'admin')).toBeDefined();
    expect(get(es as Tree, 'admin')).toBeDefined();
  });

  test('every leaf key under "admin" has EXACT parity between EN and ES (same key set)', () => {
    const enLeaves = Object.keys(flatten((get(en as Tree, 'admin') as Tree) ?? {})).filter(
      (k) => typeof get(en as Tree, `admin.${k}`) === 'string'
    );
    const esLeaves = Object.keys(flatten((get(es as Tree, 'admin') as Tree) ?? {})).filter(
      (k) => typeof get(es as Tree, `admin.${k}`) === 'string'
    );
    expect(enLeaves.sort()).toEqual(esLeaves.sort());
    expect(enLeaves.length).toBeGreaterThan(0);
  });

  test('every leaf value under "admin" is REAL ES — genuinely different text from EN', () => {
    const enFlat = flatten((get(en as Tree, 'admin') as Tree) ?? {});
    const esFlat = flatten((get(es as Tree, 'admin') as Tree) ?? {});
    for (const key of Object.keys(enFlat)) {
      if (enFlat[key] === '') continue; // intermediate object marker, not a leaf
      const fullKey = `admin.${key}`;
      expect(esFlat[key]?.length).toBeGreaterThan(0);
      if (LANGUAGE_NEUTRAL_EXEMPT.has(fullKey)) continue;
      expect(esFlat[key]).not.toBe(enFlat[key]);
    }
  });

  test('errors.INVALID_ROLE exists (real ES) — the new error code the role-change route added', () => {
    expect(get(en as Tree, 'errors.INVALID_ROLE')).toBeTruthy();
    expect(get(es as Tree, 'errors.INVALID_ROLE')).toBeTruthy();
    expect(get(es as Tree, 'errors.INVALID_ROLE')).not.toBe(get(en as Tree, 'errors.INVALID_ROLE'));
  });
});
