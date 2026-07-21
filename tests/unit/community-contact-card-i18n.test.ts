// T-R32c (i18n completion, master-spec §17.5; uiux §6.2) — `ContactCard` (`src/app/community/
// components/ContactCard.tsx`) renders once per contact on the Community home — the single
// highest-multiplicity component in this build. Carried 7 pre-existing `NO_LITERALS_BASELINE.json`
// entries plus five aria-label TEMPLATE-LITERAL blind spots the scanner cannot see (it only flags a
// bare string-literal attribute value, never a `` `${...}` `` template). Proves the full retrofit:
// EN default unchanged, genuine ES render, for every §4.6 state.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ContactCard, { type ContactCardProps } from '@/app/community/components/ContactCard';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const baseProps: ContactCardProps = {
  id: 'contact-1',
  name: 'Jamie Rivera',
  initials: 'JR',
  closeness: 3,
  recency: 'leaf',
  isRecruitTarget: false,
  isClient: false,
  onToggleRecruitTarget: () => {},
  onToggleClient: () => {},
};

const renderEn = (overrides: Partial<ContactCardProps> = {}) =>
  renderToStaticMarkup(createElement(ContactCard, { ...baseProps, ...overrides }));

const renderEs = (overrides: Partial<ContactCardProps> = {}) =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(ContactCard, { ...baseProps, ...overrides })
    )
  );

describe('ContactCard — i18n (EN default + genuine ES render, T-R32c)', () => {
  test('EN default renders the recency label, flag-toggle CTAs, and aria-label templates in English', () => {
    const html = renderEn();
    const text = textOf(html);
    expect(text).toContain('Active in the last 30 days');
    expect(text).toContain('Invite candidate');
    expect(text).toContain('Client');
    expect(text).toContain('View conversation');
    expect(html).toContain('aria-label="Contact card for Jamie Rivera"');
    expect(html).toContain('aria-label="Jamie Rivera avatar"');
    expect(html).toContain('aria-label="Closeness: 3 of 5"');
    expect(html).toContain('aria-label="Invite candidate: Jamie Rivera"');
    expect(html).toContain('aria-label="Client: Jamie Rivera"');
  });

  test('ES provider renders genuinely Spanish copy AND aria-label templates — not a silent EN fallback', () => {
    const html = renderEs();
    const text = textOf(html);
    expect(text).toContain('Activo en los últimos 30 días');
    expect(text).toContain('Candidato a invitar');
    expect(text).toContain('Cliente');
    expect(text).toContain('Ver conversación');
    expect(html).toContain('aria-label="Tarjeta de contacto de Jamie Rivera"');
    expect(html).toContain('aria-label="Avatar de Jamie Rivera"');
    expect(html).toContain('aria-label="Cercanía: 3 de 5"');
    expect(html).toContain('aria-label="Candidato a invitar: Jamie Rivera"');
    expect(html).toContain('aria-label="Cliente: Jamie Rivera"');

    expect(text).not.toContain('Active in the last 30 days');
    expect(text).not.toContain('Invite candidate');
  });

  test('the needs-info / excluded / agents-paused / removed-from-phone state chips are real, distinct EN/ES catalog entries', () => {
    expect(textOf(renderEn({ state: 'needs-info' }))).toContain('No phone or email on file');
    expect(textOf(renderEs({ state: 'needs-info' }))).toContain('No hay teléfono o correo registrado');
    expect(textOf(renderEn({ state: 'excluded' }))).toContain('Locked');
    expect(textOf(renderEs({ state: 'excluded' }))).toContain('Bloqueado');
    expect(textOf(renderEn({ state: 'agents-paused' }))).toContain('Agents paused');
    expect(textOf(renderEs({ state: 'agents-paused' }))).toContain('Agentes en pausa');
    expect(textOf(renderEn({ state: 'removed-from-phone' }))).toContain('Retained in your Vault');
    expect(textOf(renderEs({ state: 'removed-from-phone' }))).toContain('Conservado en tu Bóveda');
  });

  // TEETH: guard:i18n's doctrine copy-lint forbids the bare noun "recruit" — this proves the
  // rewording (T-R32c: "Recruit target" -> "Invite candidate") never regresses in either language.
  test('TEETH: the invite-candidate toggle never regresses to the doctrine-forbidden noun "recruit"', () => {
    expect(t('en', 'community.contactCard.recruitTargetCta')).not.toMatch(/recruit/i);
    expect(t('es', 'community.contactCard.recruitTargetCta')).not.toMatch(/reclut/i);
  });
});
