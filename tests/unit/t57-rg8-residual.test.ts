// T-57 RG8 — the terminating unit for the T-57 i18n/a11y convergence. RG7's hardened guards
// (guard:server-i18n-leak, guard:status-live-region) enumerated the FULL residual class; this test
// file proves the fixes for the rep-facing entries that were triaged out of the two shrink-only
// baselines (the other, function-level i18n fixes — override-math.ts, primerica-overlay.ts,
// org-gate.ts, cancellation.ts, booking.service.ts — have their own tests alongside their existing
// unit-test siblings; this file owns the two consolidated, multi-site checks: the RulesOfBuilding
// axioms (tree-builder.ts + RulesOfBuildingChips.tsx, incl. the DOCTRINE "recruit"→"teammate" fix)
// and the 9 status-live-region a11y fixes).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import RulesOfBuildingChips from '@/app/grow/components/RulesOfBuildingChips';
import { computeRoBChips, buildOrgTree, missingRecruitInfo } from '@/services/taprooting/tree-builder';
import { emptyNodeHealth } from '@/services/taprooting/health';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';
import type { RulesOfBuildingChips as RoBChipsType, OverrideMathSheet } from '@/types/taprooting';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const src = (...parts: string[]) => readFileSync(path.join(SRC_DIR, ...parts), 'utf8');

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

function renderEn<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(createElement(el, props));
}

function renderEs<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(el, props)
    )
  );
}

const noopOpenMath = async (): Promise<OverrideMathSheet> => ({
  depth: 1,
  potentialTeamSizeAtDepth: 3,
  narrative: 'n/a',
  safeHarborDisclaimer: 'n/a',
});

describe('T-57 RG8 — tree-builder.ts server-i18n-leak fix (structural data only)', () => {
  it('computeRoBChips returns ONLY structural fields — no label/countLabel prose baked server-side', () => {
    const edges = [
      { sponsor_id: 'root', recruit_id: 'a1' },
      { sponsor_id: 'a1', recruit_id: 'a2' },
      { sponsor_id: 'a2', recruit_id: 'a3' },
      { sponsor_id: 'a3', recruit_id: 'a4' },
    ];
    const tree = buildOrgTree(edges, 'root', () => missingRecruitInfo(), () => emptyNodeHealth());
    const chips = computeRoBChips(tree);
    for (const chip of chips.chips) {
      expect(Object.keys(chip).sort()).toEqual(['current', 'key', 'state', 'target']);
    }
  });
});

describe('T-57 RG8 — RulesOfBuildingChips.tsx: the RoB axioms render localized, doctrine-clean text', () => {
  // Fabricated chip data exercising every countLabel shape (of / ofDeep / ofLegs / emerged), so this
  // test is independent of tree-builder.ts's own business logic (already covered elsewhere).
  const chips: RoBChipsType = {
    chips: [
      { key: 'recruit_has_recruit', state: 'met', current: 1, target: 1 },
      { key: 'leg_four_deep', state: 'met', current: 4, target: 4 },
      { key: 'team_four_legs', state: 'countdown', current: 1, target: 4 },
      { key: 'leader_emerged', state: 'met', current: 3, target: 1 },
    ],
  };

  it('EN: renders the DOCTRINE-fixed axiom ("teammate", never "recruit") + the real countdown labels', () => {
    const raw = renderEn(RulesOfBuildingChips, { chips, onOpenMath: noopOpenMath });
    const html = textOf(raw);
    expect(html).toContain("A teammate isn't a teammate until they have a teammate");
    expect(html).toContain("A leg isn't a leg until it is four deep");
    expect(html).toContain("A team isn't a team until it has four legs");
    expect(html).toContain('A team gets a life of its own when a leader emerges');
    expect(html).toContain('1 of 1');
    expect(html).toContain('4 of 4 deep');
    expect(html).toContain('1 of 4 legs');
    expect(html).toContain('3 emerged');
    // TEETH — the doctrine-forbidden term must be gone from the ENTIRE markup, including the
    // aria-label attribute (which repeats the axiom text but is stripped out of `textOf`).
    expect(raw.toLowerCase()).not.toMatch(/\brecruit\b/);
  });

  it('ES: renders REAL, distinct Spanish axioms + countdown labels — doctrine-clean ("reclut" nowhere)', () => {
    const raw = renderEs(RulesOfBuildingChips, { chips, onOpenMath: noopOpenMath });
    const html = textOf(raw);
    expect(html).toContain('Un compañero de equipo no es un compañero de equipo hasta que tiene un compañero de equipo');
    expect(html).toContain('Una rama no es una rama hasta que tiene cuatro niveles de profundidad');
    expect(html).toContain('Un equipo no es un equipo hasta que tiene cuatro ramas');
    expect(html).toContain('Un equipo cobra vida propia cuando surge un líder');
    expect(html).toContain('1 de 1');
    expect(html).toContain('4 de 4 de profundidad');
    expect(html).toContain('1 de 4 ramas');
    expect(html).toContain('3 surgidos');
    // TEETH — no English leak and no forbidden "reclut" substring anywhere in the FULL markup
    // (doctrine copy-lint's own Spanish forbidden-term family, master-spec §0.5 / uiux §6.2),
    // including the aria-label attribute.
    expect(raw.toLowerCase()).not.toMatch(/\bteammate\b|\bleg isn't\b|\bemerges\b/);
    expect(raw.toLowerCase()).not.toContain('reclut');
  });
});

describe('T-57 RG8 — status-live-region: the 9 rep-facing bare-{error} sites now route through StatusMessage', () => {
  const cases: { file: string[]; needle: string }[] = [
    { file: ['app', 'community', '[contactId]', 'page.tsx'], needle: '<StatusMessage>{error}</StatusMessage>' },
    { file: ['app', 'community', 'page.tsx'], needle: '<StatusMessage className={styles.needsInfoNote}>{toggleNotice}</StatusMessage>' },
    { file: ['app', 'community', 'page.tsx'], needle: '<StatusMessage>{error}</StatusMessage>' },
    { file: ['app', 'community', 'components', 'ObjectionCoachPanel.tsx'], needle: '<StatusMessage>{loadError}</StatusMessage>' },
    {
      file: ['app', 'content', 'launch-kit', '[id]', 'page.tsx'],
      needle: "<StatusMessage className={styles.errorState}>{error ?? t('content.launchKit.notFound')}</StatusMessage>",
    },
    { file: ['app', 'content', 'templates', 'page.tsx'], needle: '<StatusMessage className={styles.errorState}>{error}</StatusMessage>' },
    {
      file: ['app', 'me', 'data-rights', 'page.tsx'],
      needle: '<StatusMessage className={styles.body}>{confirmAction.errorMessage}</StatusMessage>',
    },
    {
      file: ['app', 'me', 'data-rights', 'page.tsx'],
      needle: '<StatusMessage className={styles.body}>{exportAction.errorMessage}</StatusMessage>',
    },
    {
      file: ['app', 'me', 'data-rights', 'page.tsx'],
      needle: '<StatusMessage className={styles.body}>{requestAction.errorMessage}</StatusMessage>',
    },
  ];

  for (const { file, needle } of cases) {
    it(`${file.join('/')} renders "${needle.slice(0, 60)}…" (announced via StatusMessage)`, () => {
      expect(src(...file)).toContain(needle);
    });
  }

  it('every fixed file imports StatusMessage from the shared component', () => {
    for (const relDir of [
      ['app', 'community', '[contactId]', 'page.tsx'],
      ['app', 'community', 'page.tsx'],
      ['app', 'community', 'components', 'ObjectionCoachPanel.tsx'],
      ['app', 'content', 'launch-kit', '[id]', 'page.tsx'],
      ['app', 'content', 'templates', 'page.tsx'],
      ['app', 'me', 'data-rights', 'page.tsx'],
    ]) {
      expect(src(...relDir)).toMatch(/import \{ StatusMessage \} from '@\/components\/StatusMessage';/);
    }
  });
});
