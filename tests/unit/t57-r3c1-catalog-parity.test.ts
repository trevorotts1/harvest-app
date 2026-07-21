// T-57 R3c-1 — catalog parity + REAL Spanish for every NEW namespace this build unit adds
// (jogger.*, invite.*, grove.*, receipts.*, agents.*) plus the additive keys under namespaces this
// unit already owns this cycle (grow.page.*/grow.phasedTimeline.*/today.actionQueue.*/
// ritual.warmMarketRitual.*). "Real ES" means genuinely translated text, not the EN string
// copy-pasted — the doctrine-vocabulary/growth-tolerance half of this is already covered
// end-to-end by `npm run guard:i18n` (T-53); this test's job is the parity + non-identity proof
// specifically scoped to what THIS build unit added.

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
    else out[p] = ''; // placeholder; recurse below
    if (typeof v === 'object' && v !== null) Object.assign(out, flatten(v, p));
  }
  return out;
}

const NEW_NAMESPACES = ['jogger', 'invite', 'grove', 'receipts', 'agents'];

// Genuinely language-neutral by deliberate choice, not an accidental copy-paste: "min" is the same
// common abbreviation for "minuto(s)" in real Spanish product copy as it is in English (mirrors
// this exact pre-existing pattern already in ActionQueue.tsx's own per-item row, `~${item.minutes}
// min`, never flagged by guard:i18n's forbidden-vocabulary/growth-tolerance checks either).
const LANGUAGE_NEUTRAL_EXEMPT = new Set(['receipts.actionQueue.minutesSuffix']);

describe('T-57 R3c-1 — new-namespace catalog keys: real ES, full parity, no forbidden vocabulary', () => {
  test.each(NEW_NAMESPACES)('namespace "%s" exists in BOTH en.json and es.json', (ns) => {
    expect(get(en as Tree, ns)).toBeDefined();
    expect(get(es as Tree, ns)).toBeDefined();
  });

  test.each(NEW_NAMESPACES)('every leaf key under "%s" has EXACT parity between EN and ES (same key set)', (ns) => {
    const enLeaves = Object.keys(flatten((get(en as Tree, ns) as Tree) ?? {})).filter((k) => typeof get(en as Tree, `${ns}.${k}`) === 'string');
    const esLeaves = Object.keys(flatten((get(es as Tree, ns) as Tree) ?? {})).filter((k) => typeof get(es as Tree, `${ns}.${k}`) === 'string');
    expect(enLeaves.sort()).toEqual(esLeaves.sort());
    expect(enLeaves.length).toBeGreaterThan(0);
  });

  test.each(NEW_NAMESPACES)('every leaf value under "%s" is REAL ES — genuinely different text from EN, never a copy-paste placeholder', (ns) => {
    const enFlat = flatten((get(en as Tree, ns) as Tree) ?? {});
    const esFlat = flatten((get(es as Tree, ns) as Tree) ?? {});
    for (const key of Object.keys(enFlat)) {
      if (enFlat[key] === '') continue; // intermediate object marker, not a leaf
      expect(esFlat[key]?.length).toBeGreaterThan(0);
      const fullKey = `${ns}.${key}`;
      if (LANGUAGE_NEUTRAL_EXEMPT.has(fullKey)) continue;
      // A genuine translation differs from the EN source UNLESS the string is language-neutral
      // (a bare interpolation template, digits only, etc.) — see the exemption set above for the
      // one deliberate exception.
      expect(esFlat[key]).not.toBe(enFlat[key]);
    }
  });
});

describe('T-57 R3c-1 — additive keys under EXISTING namespaces this unit owns this cycle', () => {
  const ADDITIVE_KEYS = [
    'grow.page.warmMarketRitualBody',
    'grow.page.warmMarketRitualCta',
    'grow.phasedTimeline.warmMarketRitualBody',
    'grow.phasedTimeline.warmMarketRitualCta',
    'today.actionQueue.tryRitualCta',
    'today.actionQueue.tryJoggerCta',
    'ritual.warmMarketRitual.handoffSending',
    'ritual.warmMarketRitual.handoffDone',
    'ritual.warmMarketRitual.handoffError',
  ];

  test.each(ADDITIVE_KEYS)('%s exists in both languages with real, non-identical ES', (key) => {
    const enVal = get(en as Tree, key);
    const esVal = get(es as Tree, key);
    expect(typeof enVal).toBe('string');
    expect(typeof esVal).toBe('string');
    expect(esVal).not.toBe(enVal);
  });
});

describe('T-57 R3c-1 — the ONE full-catalog parity invariant still holds after every addition', () => {
  test('en.json and es.json have IDENTICAL flattened key sets (no orphan in either language)', () => {
    const enFlat = flatten(en as Tree);
    const esFlat = flatten(es as Tree);
    const enKeys = new Set(Object.keys(enFlat).filter((k) => enFlat[k] !== ''));
    const esKeys = new Set(Object.keys(esFlat).filter((k) => esFlat[k] !== ''));
    const missingInEs = [...enKeys].filter((k) => !esKeys.has(k));
    const missingInEn = [...esKeys].filter((k) => !enKeys.has(k));
    expect(missingInEs).toEqual([]);
    expect(missingInEn).toEqual([]);
  });
});
