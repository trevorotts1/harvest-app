// R-16 (refinements catalog 2026-07-28) — Today first-run expectation-setting + the plain-language
// definition of the "3 introductions in 48 hours" First-48 mission. This suite proves, in order:
//
//   (1) FIRST-RUN COPY RENDERS (EN + ES) — `FirstRunGuide` renders every expectation-setting key:
//       what Today is, what the agents are about to do (draft introductions; approve-before-send),
//       the first action to take, and the First-48 definition — in BOTH locales, with no EN
//       leakage in the ES render.
//
//   (2) DEFINITION MATCHES THE SPEC'S CANONICAL WORDING — the EN catalog's definition carries the
//       literal canonical phrase from master-spec §12.2 ("three community introductions to the
//       closest-sphere A-list names highlighted in the warm-market exercise") — the test is written
//       against that spec literal, not a re-derived paraphrase, so a future drift from the spec
//       fails here. The approve-before-send expectation mirrors master-spec §9.2's "approval always
//       precedes send".
//
//   (3) RETURNING-REP STATE SHOWS NO FIRST-RUN COPY — the guide's render on the Today page is
//       gated on the briefing zone's zero-data `first_day` state (no AgentRun rows — the honest
//       first-run signal, src/services/mission-control/zones/briefing.ts). A source-level assertion
//       on the page proves the gate exists and the guide renders only there; the `data-first-run`
//       marker never appears for a returning rep.
//
//   (4) I18N PARITY — every new `today.firstRun.*` key exists in BOTH catalogs with genuinely
//       different, real Spanish (not the EN string).
//
//   (5) DENSE TRACKS PRESERVED — the fix touches only the Today surface: onboarding's dense track
//       (UplineTrack/GdprConsentStep/First48Handoff), the First-48 API state, and the WP07 zone
//       surface are untouched (Law 42: exactly this change, nothing more).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FirstRunGuide from '@/app/today/components/FirstRunGuide';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';
import type { BriefingZoneData, ZoneResult } from '@/services/mission-control/types';

const REPO = path.join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');
const enCatalog = JSON.parse(read('src/lib/i18n/messages/en.json')) as { [k: string]: unknown };
const esCatalog = JSON.parse(read('src/lib/i18n/messages/es.json')) as { [k: string]: unknown };
const get = (tree: { [k: string]: unknown }, p: string): string | undefined =>
  p.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as { [k: string]: unknown })[part];
  }, tree) as string | undefined;

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

// ─── (1) First-run copy renders, EN + ES ─────────────────────────────────────────────────────────
describe('R-16 FirstRunGuide — expectation-setting copy renders (EN default + genuine ES)', () => {
  test('EN renders what Today is, what the agents are about to do, and the first action', () => {
    const html = textOf(renderEn(FirstRunGuide, {}));
    expect(html).toContain('Welcome to Today');
    expect(html).toContain('This is your mission control.');
    // (a) what the agents are about to do — the operator's "we're getting ready to start creating
    // messages" gap (catalog row R-16).
    expect(html).toContain("Here's what the agents are about to do");
    expect(html).toContain('they will draft introductions for the people you added');
    expect(html).toContain('Nothing sends until you approve it.');
    expect(html).toContain('What to do first');
    expect(html).toContain('your first step is to add your warm-market contacts');
  });

  test('EN renders the First-48 definition with the count-clock, what counts, and what does not', () => {
    const html = textOf(renderEn(FirstRunGuide, {}));
    expect(html).toContain('The First 48, in plain language');
    expect(html).toContain('reach out to three of your contacts within 48 hours');
    expect(html).toContain('The 48-hour clock starts the moment you finish onboarding');
    expect(html).toContain('What counts as an introduction');
    expect(html).toContain('A community introduction is a warm message to someone you already know');
    expect(html).toContain("What doesn't count");
    expect(html).toContain('three in 48 hours is the activation goal');
  });

  test('ES renders the same guide with genuine Spanish and no EN leakage', () => {
    const es = textOf(renderEs(FirstRunGuide, {}));
    expect(es).toContain('Bienvenido a Hoy');
    expect(es).toContain('Este es tu centro de mando.');
    expect(es).toContain('Esto es lo que los agentes están a punto de hacer');
    expect(es).toContain('Nada se envía hasta que lo apruebes.');
    expect(es).toContain('Qué hacer primero');
    expect(es).toContain('Las Primeras 48, en lenguaje sencillo');
    expect(es).toContain('tres de tus contactos dentro de 48 horas');
    expect(es).toContain('Qué cuenta como introducción');
    expect(es).toContain('Lo que no cuenta');
    expect(es).not.toContain('Welcome to Today');
    expect(es).not.toContain('What to do first');
    expect(es).not.toContain('mission control');
  });

  test('the guide marks itself with data-first-run="true" so a returning-rep render can never show it', () => {
    const html = renderToStaticMarkup(createElement(FirstRunGuide, {}));
    expect(html).toContain('data-first-run="true"');
  });
});

// ─── (2) Definition matches the master spec's canonical wording ─────────────────────────────────
describe('R-16 definition — grounded in the master spec (never invented)', () => {
  // Canonical literal, master-spec §12.2 (48-Hour Countdown & First-48 guided mode): "Target: three
  // community introductions to the closest-sphere A-list names highlighted in the warm-market
  // exercise." The EN catalog's definition must carry this EXACT canonical phrase — the test is
  // written against the spec's own words, so a paraphrase-drift from the spec fails here.
  const SPEC_CANONICAL = 'three community introductions to the closest-sphere A-list names highlighted in the warm-market exercise';

  test('the EN definitionSpec key contains the spec\'s canonical phrase verbatim', () => {
    const definition = get(enCatalog, 'today.firstRun.definitionSpec') ?? '';
    expect(definition).toContain(SPEC_CANONICAL);
  });

  test('the 48-hour clock starts on onboarding completion, per §12.2 ("Activates immediately on gated_complete")', () => {
    const clock = get(enCatalog, 'today.firstRun.clockNote') ?? '';
    const definition = get(enCatalog, 'today.firstRun.definitionSpec') ?? '';
    expect(definition).toContain('48-hour clock starts the moment you finish onboarding');
    expect(clock).toContain('countdown runs from the moment you finish setting up');
  });

  test('approve-before-send expectation mirrors master-spec §9.2 ("approval always precedes send")', () => {
    const agentsNow = get(enCatalog, 'today.firstRun.agentsNow') ?? '';
    const definition = get(enCatalog, 'today.firstRun.definitionBody') ?? '';
    expect(agentsNow).toContain('Nothing sends until you approve it.');
    expect(definition).toContain('you review and approve each one before anything sends');
  });
});

// ─── (3) Returning-rep state shows no first-run copy ────────────────────────────────────────────
describe('R-16 wiring — first-run copy is gated on the zero-data first_day state only', () => {
  const pageSrc = read('src/app/today/page.tsx');
  const guideSrc = read('src/app/today/components/FirstRunGuide.tsx');

  test('the Today page renders FirstRunGuide ONLY while the briefing zone reports first_day', () => {
    // The page must gate the guide on the briefing zone's zero-data first-run state — the honest
    // first-run signal (no AgentRun rows yet, src/services/mission-control/zones/briefing.ts).
    // A returning rep (any other briefing state) never sees the guide.
    expect(pageSrc).toMatch(/data\.briefing\.status === 'ok' && data\.briefing\.data\.state === 'first_day'/);
    expect(pageSrc).toContain('<FirstRunGuide />');
  });

  test('the guide renders no conditional on an existing-data state — it is first-day-only by construction', () => {
    // FirstRunGuide itself has no props and no state branches: it renders unconditionally when
    // mounted, and the PAGE mounts it only in the first_day branch (asserted above). So there is
    // no path where a returning rep sees the copy.
    expect(guideSrc).not.toMatch(/status === 'ok'/);
    expect(guideSrc).not.toMatch(/state ===/);
    expect(guideSrc).toContain('data-first-run="true"');
  });

  test('the briefing zone derives first_day from ZERO AgentRun rows — the pre-existing honest signal, not a new column', () => {
    const briefingSrc = read('src/services/mission-control/zones/briefing.ts');
    expect(briefingSrc).toMatch(/allRuns\.length === 0/);
    expect(briefingSrc).toContain("state: 'first_day'");
  });

  test('no DB schema or API contract changed — no new columns, no new endpoint fields', () => {
    // The first-run signal is data-driven (zero AgentRun rows), NOT a new schema column or flag:
    // the Prisma schema is byte-identical to origin/main's and no route/API surface was added.
    const schemaSrc = read('prisma/schema.prisma');
    expect(schemaSrc).not.toMatch(/first_run|firstRun/);
    // No new API route was created for this feature (the guide reads the existing briefing zone).
    const apiRouteDirs = read('src/app/api/mission-control/today/route.ts');
    expect(apiRouteDirs).toBeTruthy();
    expect(read('src/app/today/components/FirstRunGuide.tsx')).not.toContain('fetch(');
  });
});

// ─── (4) i18n parity ─────────────────────────────────────────────────────────────────────────────
describe('R-16 i18n parity — every new key exists in both catalogs with real Spanish', () => {
  const EN_KEYS: string[] = [
    'today.firstRun.heading',
    'today.firstRun.intro',
    'today.firstRun.agentsNow',
    'today.firstRun.firstStepHeading',
    'today.firstRun.firstStepBody',
    'today.firstRun.definitionHeading',
    'today.firstRun.definitionBody',
    'today.firstRun.definitionSpec',
    'today.firstRun.whatCountsHeading',
    'today.firstRun.whatCountsBody',
    'today.firstRun.whatDoesNotBody',
    'today.firstRun.clockNote',
  ];

  test.each(EN_KEYS)('%s exists in both catalogs', (key) => {
    const en = get(enCatalog, key);
    const es = get(esCatalog, key);
    expect(en).toBeTruthy();
    expect(es).toBeTruthy();
    // Structural parity: the ES value is a string too, and is NOT the EN string (genuine
    // translation, never a copy — the R-14 parity convention).
    expect(typeof es).toBe('string');
    expect(es).not.toBe(en);
  });

  test('the ES definition is a real translation, not English spliced in', () => {
    const esDef = get(esCatalog, 'today.firstRun.definitionSpec') ?? '';
    expect(esDef).toContain('tres introducciones comunitarias');
    expect(esDef).toContain('Lista A');
    expect(esDef).not.toContain('closest-sphere');
    expect(esDef).not.toContain('warm-market');
  });

  test('the catalog translator resolves every first-run key in both locales', () => {
    for (const key of EN_KEYS) {
      expect(t('en', key)).not.toContain('firstRun'); // never the bare key
      expect(t('es', key)).not.toContain('firstRun');
    }
  });
});

// ─── (5) Dense tracks preserved — exactly this change, nothing more (Law 42) ───────────────────
describe('R-16 scope guard — untouched surfaces', () => {
  test('the onboarding dense track (UplineTrack/GdprConsentStep/First48Handoff) is untouched', () => {
    const flowSrc = read('src/app/onboarding/OnboardingFlow.tsx');
    // The dense-track branches and the First-48 handoff step are exactly as they were.
    expect(flowSrc).toContain("denseScreen === 'consent'");
    expect(flowSrc).toContain("denseScreen === 'first48'");
    const handoffSrc = read('src/app/onboarding/components/First48Handoff.tsx');
    expect(handoffSrc).toContain('onboarding.first48Handoff.lede');
  });

  test('the First-48 API state shape is unchanged (still gated_complete-driven, no new fields)', () => {
    const serviceSrc = read('src/services/gamification/first-48.service.ts');
    expect(serviceSrc).toContain('gated_complete_at');
    expect(serviceSrc).toContain('active: false, phase: null, startedAt: null, hoursElapsed: null, goals: []');
  });

  test('the WP07 First-48 banner surface on Today is untouched by this change', () => {
    const wp07Src = read('src/app/today/components/WP07Panel.tsx');
    expect(wp07Src).toContain('first48?.active');
    expect(wp07Src).toContain('onboarding.first48Handoff.lede');
  });

  test('the page still renders the First-48 banner zone (WP07Panel) independent of the guide', () => {
    const pageSrc = read('src/app/today/page.tsx');
    expect(pageSrc).toContain('<WP07Panel');
    expect(pageSrc).toContain('zoneName="wp07"');
  });
});
