// T-R32b (master-spec §17.5; uiux §6.2) — `AnchorHeader` (Today's persistent zone-1 header, rendered
// on every visit to the app's primary landing surface) carried 17 pre-existing
// `NO_LITERALS_BASELINE.json` entries, PLUS two genuinely-broken-but-unflagged spots the baseline
// scanner cannot see (it only scans JSX text/attribute literals, not object-literal maps rendered
// through a variable): the `BAND_LABEL` momentum-band map (hardcoded EN, now routed through the
// previously-unused `today.momentum.*` catalog keys) and the "Grow:/Engage:/Wealth:" law labels.
// Proves the full retrofit: EN default unchanged, genuine ES render, no EN leakage.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AnchorHeader from '@/app/today/components/AnchorHeader';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';
import type { HeaderZoneData, ZoneResult } from '@/services/mission-control/types';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

function baseData(overrides: Partial<HeaderZoneData> = {}): HeaderZoneData {
  return {
    greetingName: 'Jordan',
    momentum: { score: 72, band: 'growing', sparkline: [10, 20, 30, 40, 50, 60, 72], laws: { grow: 70, engage: 75, wealth: 71 }, totalEventCount: 12 },
    groveState: 'growing',
    groveCaption: 'Growing',
    approvalInboxCount: 3,
    ...overrides,
  };
}

const renderEn = (data: HeaderZoneData) =>
  renderToStaticMarkup(createElement(AnchorHeader, { result: { status: 'ok', data } as ZoneResult<HeaderZoneData> }));

const renderEs = (data: HeaderZoneData) =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(AnchorHeader, { result: { status: 'ok', data } as ZoneResult<HeaderZoneData> })
    )
  );

describe('AnchorHeader — i18n (EN default + genuine ES render, T-R32b)', () => {
  test('EN default renders the greeting, the retained Approval Inbox affordance, and the momentum band label in English', () => {
    const html = renderEn(baseData());
    const text = textOf(html);
    expect(text).toContain('Good morning, Jordan');
    expect(text).toContain('Approval Inbox');
    expect(text).toContain('Growing'); // momentum band label, via today.momentum.growing
    // T-57 R2: the redundant destination + Me-subsurface pills (Grow/Community/Subscription/Data &
    // Privacy/Language) moved to the persistent AppShell nav + the /me hub, so the Today header no
    // longer carries them. Only the §2.3-item-1 mobile Approval Inbox affordance stays.
    expect(html).not.toContain('href="/community"');
    expect(html).not.toContain('href="/grow"');
    expect(html).not.toContain('href="/me/subscription"');
    expect(html).not.toContain('href="/me/data-rights"');
    expect(html).not.toContain('href="/me/language"');
    expect(html).toContain('href="/inbox"');
    expect(html).toContain('aria-label="Approval Inbox, 3 waiting"'); // localized, count-interpolated
  });

  test('ES provider renders genuinely Spanish header copy — not a silent EN fallback', () => {
    const html = renderEs(baseData());
    const text = textOf(html);
    expect(text).toContain('Buenos días, Jordan');
    expect(text).toContain('Bandeja de aprobación');
    expect(text).toContain('Creciendo'); // today.momentum.growing (ES)
    expect(html).toContain('aria-label="Bandeja de aprobación, 3 en espera"');

    // None of the EN-only strings leak into the ES render. (`groveCaption` itself is server-computed
    // narration text passed straight through as a prop — out of this retrofit's scope — so it is
    // deliberately not asserted on here; the momentum BAND label it's adjacent to, "Creciendo", is
    // the catalog-driven string this test targets, and it's covered by the assertion above.)
    expect(text).not.toContain('Good morning');
    expect(text).not.toContain('Approval Inbox');
  });

  test('the momentum band label is genuinely catalog-driven for every band, in both locales (not just the one demo\'d elsewhere)', () => {
    const bands: Array<[HeaderZoneData['momentum']['band'], string, string]> = [
      ['thriving', 'Thriving', 'Floreciendo'],
      ['quiet', 'Quiet', 'Tranquilo'],
      ['resting', 'Resting', 'En reposo'],
    ];
    for (const [band, en, es] of bands) {
      const data = baseData({ momentum: { ...baseData().momentum, band } });
      expect(textOf(renderEn(data))).toContain(en);
      expect(textOf(renderEs(data))).toContain(es);
    }
  });

  // The Grow/Engage/Wealth law labels, the "ten criteria" heading, and the receipts CTA all live
  // INSIDE the `receiptsOpen` panel, which only appears after a `momentumButton` click
  // (`setReceiptsOpen`) — a client interaction this repo's Jest env (plain `testEnvironment: 'node'`,
  // no jsdom, per jest.config.js) cannot simulate against a single-pass `renderToStaticMarkup` call;
  // no existing test in this suite exercises that panel's content either (confirmed: no other test
  // file references `receiptsOpen`/`momentumCriteria`). Asserting the catalog keys they resolve
  // through instead is the closest honest coverage available without adding jsdom as a new
  // dependency — the component-side wiring itself (`t('today.laws.grow')`, etc.) was hand-verified
  // by reading the diff.
  test('the receipts-panel catalog keys (Grow/Engage/Wealth laws + "the ten criteria" heading + CTA) resolve to real, distinct EN/ES copy', () => {
    expect(t('en', 'today.laws.grow')).toBe('Grow');
    expect(t('en', 'today.laws.engage')).toBe('Engage');
    expect(t('en', 'today.laws.wealth')).toBe('Wealth');
    expect(t('en', 'today.criteriaHeading')).toBe('The ten criteria feeding your Grove');
    expect(t('en', 'today.receiptsCta')).toBe('See the one action that helps most');
    expect(t('es', 'today.laws.grow')).toBe('Cultivar');
    expect(t('es', 'today.laws.engage')).toBe('Interactuar');
    expect(t('es', 'today.laws.wealth')).toBe('Riqueza');
    expect(t('es', 'today.criteriaHeading')).toBe('Los diez criterios que alimentan tu vergel');
    expect(t('es', 'today.receiptsCta')).toBe('Ver la acción que más ayuda');
  });

  test('the error state (independent zone failure) is untouched by this retrofit', () => {
    const html = renderToStaticMarkup(
      createElement(AnchorHeader, { result: { status: 'error', message: 'boom' } as ZoneResult<HeaderZoneData> })
    );
    expect(textOf(html)).toContain('boom');
  });
});
