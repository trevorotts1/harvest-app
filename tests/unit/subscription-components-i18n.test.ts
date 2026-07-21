// T-R32 (master-spec §17.5; uiux §6.2) — `BillingBanner`/`TierCard` (Me → Subscription, uiux §5.8)
// were fully retrofitted off hardcoded EN literals onto the i18n catalog (26 pre-existing
// `NO_LITERALS_BASELINE.json` entries across the subscription surface). Proves EN regression safety
// + genuine ES rendering via an explicit `<LocaleContext.Provider>`, plus the locale-aware
// `canceled_active_until` date (was a hardcoded `toLocaleDateString('en-US', ...)`).
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import BillingBanner from '@/app/me/subscription/components/BillingBanner';
import TierCard, { type TierCardData } from '@/app/me/subscription/components/TierCard';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';
import type { BillingStateView } from '@/types/payment';

// `renderToStaticMarkup` HTML-escapes a literal apostrophe as `&#x27;` — decode that back to `'`
// BEFORE stripping other (named) entities to a space, so a possessive like "sponsor's" round-trips
// intact instead of becoming "sponsor s".
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

function esProvider(children: ReactNode) {
  return createElement(
    LocaleContext.Provider,
    { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
    children
  );
}

function baseState(overrides: Partial<BillingStateView> = {}): BillingStateView {
  return {
    user_id: 'u-1',
    plan_tier: 'individual',
    billing_cycle: 'monthly',
    status: null,
    phase: 'active',
    current_period_end: null,
    sponsor_user_id: null,
    sponsorship_state: null,
    sponsorship_term_end: null,
    sponsorship_grace_until: null,
    payment_method: null,
    ...overrides,
  } as BillingStateView;
}

describe('BillingBanner — i18n (EN default + genuine ES render, T-R32)', () => {
  test('EN: payment received (quiet confirmation, AC-5.8-9)', () => {
    const html = renderToStaticMarkup(createElement(BillingBanner, { state: baseState(), justPaid: true }));
    expect(textOf(html)).toContain('Payment received');
    expect(textOf(html)).toContain('back to the field');
  });

  test('ES: payment received renders genuinely Spanish copy, not a silent EN fallback', () => {
    const html = renderToStaticMarkup(esProvider(createElement(BillingBanner, { state: baseState(), justPaid: true })));
    const text = textOf(html);
    expect(text).toContain('Pago recibido');
    expect(text).not.toContain('Payment received');
  });

  test('EN + ES: member_grace lifecycle banner (sponsor-lapse cascade, §15.3)', () => {
    const state = baseState({ phase: 'member_grace' });
    const en = textOf(renderToStaticMarkup(createElement(BillingBanner, { state, justPaid: false })));
    const es = textOf(renderToStaticMarkup(esProvider(createElement(BillingBanner, { state, justPaid: false }))));
    expect(en).toContain("sponsor's payment needs attention");
    expect(es).toContain('El pago de tu patrocinador necesita atención');
  });

  test('EN + ES: soft_suspended banner ("agents resting")', () => {
    const state = baseState({ phase: 'soft_suspended' });
    const en = textOf(renderToStaticMarkup(createElement(BillingBanner, { state, justPaid: false })));
    const es = textOf(renderToStaticMarkup(esProvider(createElement(BillingBanner, { state, justPaid: false }))));
    expect(en).toContain('resting until billing is settled');
    expect(es).toContain('en reposo hasta que se resuelva la facturación');
  });

  test('T-R32 §17.5: canceled_active_until date is locale-aware — Spanish month name for es, not hardcoded en-US', () => {
    const periodEndIso = '2026-08-15T12:00:00Z'; // noon UTC — same calendar day across every real-world timezone
    const state = baseState({ phase: 'canceled_active_until', current_period_end: periodEndIso });
    const en = textOf(renderToStaticMarkup(createElement(BillingBanner, { state, justPaid: false })));
    const es = textOf(renderToStaticMarkup(esProvider(createElement(BillingBanner, { state, justPaid: false }))));
    const expectedEn = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(periodEndIso));
    const expectedEs = new Intl.DateTimeFormat('es-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(periodEndIso));
    expect(en).toContain(expectedEn);
    expect(es).toContain(expectedEs);
    expect(es).toContain('de agosto de');
    expect(en).toContain('full access until');
    expect(es).toContain('acceso completo hasta');
  });

  test('an unrecognized/active phase renders nothing (no crash, no stale banner)', () => {
    const html = renderToStaticMarkup(createElement(BillingBanner, { state: baseState({ phase: 'active' }), justPaid: false }));
    expect(html).toBe('');
  });
});

describe('TierCard — i18n (EN default + genuine ES render, T-R32)', () => {
  const tier: TierCardData = { plan_tier: 'individual', display_name: 'Individual', price_line: '$297/month' };

  test('EN: current-plan badge + tier body render EN catalog copy', () => {
    const html = renderToStaticMarkup(createElement(TierCard, { tier, isCurrent: true, cta: null }));
    const text = textOf(html);
    expect(text).toContain('Your plan');
    expect(text).toContain('The full platform');
  });

  test('ES: current-plan badge + tier body render genuinely Spanish copy', () => {
    const html = renderToStaticMarkup(esProvider(createElement(TierCard, { tier, isCurrent: true, cta: null })));
    const text = textOf(html);
    expect(text).toContain('Tu plan');
    expect(text).toContain('La plataforma completa');
    expect(text).not.toContain('Your plan');
  });

  test('the free and enterprise tier bodies also translate', () => {
    const free: TierCardData = { plan_tier: 'free', display_name: 'Sponsored', price_line: '$0' };
    const enterprise: TierCardData = { plan_tier: 'enterprise', display_name: 'Enterprise', price_line: '$25,000/yr' };
    const enFree = textOf(renderToStaticMarkup(createElement(TierCard, { tier: free, isCurrent: false, cta: null })));
    const esFree = textOf(renderToStaticMarkup(esProvider(createElement(TierCard, { tier: free, isCurrent: false, cta: null }))));
    expect(enFree).toContain('Downline Sponsor covers your first year');
    expect(esFree).toContain('patrocinador de línea descendente cubre tu primer año');

    const enEnt = textOf(renderToStaticMarkup(createElement(TierCard, { tier: enterprise, isCurrent: false, cta: null })));
    const esEnt = textOf(renderToStaticMarkup(esProvider(createElement(TierCard, { tier: enterprise, isCurrent: false, cta: null }))));
    expect(enEnt).toContain('dedicated support');
    expect(esEnt).toContain('soporte dedicado');
  });

  test('a provided CTA label renders verbatim (already translated by the caller) in either locale', () => {
    const html = renderToStaticMarkup(
      createElement(TierCard, { tier, isCurrent: false, cta: { label: 'Continuar por $297', onClick: () => {} } })
    );
    expect(textOf(html)).toContain('Continuar por $297');
  });
});
