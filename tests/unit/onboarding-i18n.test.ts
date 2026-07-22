// T-R32b (master-spec §17.5; uiux §6.2) — the O-1..O-9 onboarding component set is the first-run
// journey every rep sees exactly once, immediately after auth — carried the second-largest
// concentration of pre-existing `NO_LITERALS_BASELINE.json` entries (72 across 13 files). Proves the
// full retrofit off hardcoded EN literals onto the i18n catalog for each step: EN default unchanged,
// genuine ES render, no EN leakage. Rendered with `createElement` (no JSX) so this file can stay a
// `.test.ts`, matching this suite's own onboarding-ui.test.ts convention.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { IntensitySetting, OrgType, Role } from '@prisma/client';

import ContactImportStep from '@/app/onboarding/components/ContactImportStep';
import GdprConsentStep from '@/app/onboarding/components/GdprConsentStep';
import IdentityStep from '@/app/onboarding/components/IdentityStep';
import IntensityDial from '@/app/onboarding/components/IntensityDial';
import { OrgBranchPanel } from '@/app/onboarding/components/OrgStep';
import OutreachConsentToggle from '@/app/onboarding/components/OutreachConsentToggle';
import First48Handoff from '@/app/onboarding/components/First48Handoff';
import SevenSeedStepper from '@/app/onboarding/components/SevenSeedStepper';
import SevenWhysConversation from '@/app/onboarding/components/SevenWhysConversation';
import SponsorStep from '@/app/onboarding/components/SponsorStep';
import UplineTrack from '@/app/onboarding/components/UplineTrack';
import { buildOrgContext } from '@/services/onboarding/wp01/org-gate';
import { SevenWhysLevel, type SevenWhysRenderedTurn } from '@/services/onboarding/wp01/seven-whys';
import type { SponsorMatchOutcome } from '@/services/onboarding/wp01/sponsor-matching';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

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

describe('Onboarding i18n (EN default + genuine ES render, T-R32b)', () => {
  test('ContactImportStep — all four beats translate', () => {
    expect(textOf(renderEn(ContactImportStep, { beat: 'value' }))).toContain('Your community is your field');
    expect(textOf(renderEs(ContactImportStep, { beat: 'value' }))).toContain('Tu comunidad es tu campo');

    expect(textOf(renderEn(ContactImportStep, { beat: 'preview' }))).toContain('Connect my contacts');
    expect(textOf(renderEs(ContactImportStep, { beat: 'preview' }))).toContain('Conectar mis contactos');

    expect(textOf(renderEn(ContactImportStep, { beat: 'denied' }))).toContain('Import a CSV');
    expect(textOf(renderEs(ContactImportStep, { beat: 'denied' }))).toContain('Importar un CSV');
    expect(textOf(renderEn(ContactImportStep, { beat: 'denied', csvImporting: true }))).toContain('Importing…');
    expect(textOf(renderEs(ContactImportStep, { beat: 'denied', csvImporting: true }))).toContain('Importando…');

    expect(textOf(renderEn(ContactImportStep, { beat: 'permission' }))).toContain('Bringing in your community');
    expect(textOf(renderEs(ContactImportStep, { beat: 'permission' }))).toContain('Incorporando tu comunidad');
  });

  // T-58 — the two additive beats replacing the old fake "Import from Phone" success path.
  test('ContactImportStep — "select" and "unsupported" beats (T-58 real device-contacts flow) translate', () => {
    expect(textOf(renderEn(ContactImportStep, { beat: 'select', nativeCandidates: [] }))).toContain(
      "We couldn't find any importable contacts on this device.".replace("'", '’')
    );
    expect(textOf(renderEs(ContactImportStep, { beat: 'select', nativeCandidates: [] }))).toContain(
      'No encontramos contactos que se puedan importar en este dispositivo.'
    );

    const candidates = [
      { contactId: 'c-1', row: { name: 'Jane Doe', phone: '312-555-0100', email: null, notes: null, industry: null, birthdate: null }, isDuplicate: false },
    ];
    expect(textOf(renderEn(ContactImportStep, { beat: 'select', nativeCandidates: candidates }))).toContain(
      'Choose who to bring in'
    );
    expect(textOf(renderEs(ContactImportStep, { beat: 'select', nativeCandidates: candidates }))).toContain(
      'Elige a quién incorporar'
    );

    expect(textOf(renderEn(ContactImportStep, { beat: 'unsupported' }))).toContain(
      "Phone import isn't available here".replace("'", '’')
    );
    expect(textOf(renderEs(ContactImportStep, { beat: 'unsupported' }))).toContain(
      'La importación desde el teléfono no está disponible aquí'
    );
    expect(textOf(renderEs(ContactImportStep, { beat: 'unsupported' }))).not.toMatch(/phone import isn/i);
  });

  test('IdentityStep — headline, photo actions, field labels, and caption translate', () => {
    const props = { name: '', email: '' };
    const en = textOf(renderEn(IdentityStep, props));
    const es = textOf(renderEs(IdentityStep, props));
    expect(en).toContain("Let's get your details".replace("'", "’"));
    expect(en).toContain('Take a photo');
    expect(en).toContain('Your name');
    expect(en).toContain('Email');
    expect(es).toContain('Completemos tus datos');
    expect(es).toContain('Tomar una foto');
    expect(es).toContain('Tu nombre');
    expect(es).toContain('Correo electrónico');
    expect(es).not.toContain('Take a photo');
  });

  test('SponsorStep — linked branch (headline, sponsor-fallback name, accept/no-upline) translates', () => {
    const outcome: SponsorMatchOutcome = {
      kind: 'linked',
      sponsorId: 'u-1',
      source: 'automated_match',
      termStart: new Date(),
      termEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    };
    const en = textOf(renderEn(SponsorStep, { outcome }));
    const es = textOf(renderEs(SponsorStep, { outcome }));
    expect(en).toContain('We found your Downline Sponsor');
    expect(en).toContain('Your sponsor'); // fallback name, no sponsorName prop supplied
    expect(en).toContain('Accept');
    expect(es).toContain('Encontramos a tu patrocinador de línea descendente');
    expect(es).toContain('Tu patrocinador');
    expect(es).toContain('Aceptar');
    expect(es).not.toContain('Accept');
  });

  test('SponsorStep — waitlisted branch (headline, both equal-weight CTAs, no-upline-continue) translates', () => {
    const outcome: SponsorMatchOutcome = {
      kind: 'waitlisted',
      orgType: OrgType.EXTERNAL,
      paidPathTier: 'PAID_INDIVIDUAL',
      noUplineYetIsComplete: true,
      waitlistedAt: new Date(),
    };
    const en = textOf(renderEn(SponsorStep, { outcome }));
    const es = textOf(renderEs(SponsorStep, { outcome }));
    expect(en).toContain('No sponsor is available for your organization right now');
    expect(en).toContain('Join the waitlist');
    expect(en).toContain('Start today for $297/month');
    expect(en).toContain('No upline yet — continue');
    expect(es).toContain('No hay un patrocinador disponible para tu organización en este momento');
    expect(es).toContain('Unirme a la lista de espera');
    expect(es).toContain('Comenzar hoy por $297/mes');
    expect(es).toContain('Sin línea ascendente aún — continuar');
  });

  test('UplineTrack — headline and DUAL persona-switcher labels translate', () => {
    const props = { role: Role.DUAL, licensingState: 'LICENSED' as const };
    const en = textOf(renderEn(UplineTrack, props));
    const es = textOf(renderEs(UplineTrack, props));
    expect(en).toContain('Set up your team account');
    expect(en).toContain('My rep setup');
    expect(en).toContain('My team setup');
    expect(es).toContain('Configura tu cuenta de equipo');
    expect(es).toContain('Mi configuración de rep');
    expect(es).toContain('Mi configuración de equipo');
  });

  // RVP is one of the roles whose track has a licensure-gated step (stepsForRole) — REP/DUAL('rep')
  // tracks don't, so the license-state label and the blocked-compliance panel need an
  // UPLINE/RVP-shaped role to actually render at all.
  test('UplineTrack — the license-state label translates', () => {
    const props = { role: Role.RVP, licensingState: 'LICENSED' as const };
    const en = textOf(renderEn(UplineTrack, props));
    const es = textOf(renderEs(UplineTrack, props));
    expect(en).toContain('Cleared'); // LICENSE_LABEL_KEY — not a JSX literal, genuinely re-verified here
    expect(es).toContain('Aprobada');
    expect(es).not.toContain('Cleared');
  });

  test('UplineTrack — the blocked (license not cleared) compliance-routing panel translates', () => {
    const props = { role: Role.RVP, licensingState: 'UNLICENSED' as const };
    const en = textOf(renderEn(UplineTrack, props));
    const es = textOf(renderEs(UplineTrack, props));
    expect(en).toContain("We can't finish setup until your license clears.".replace("'", "’"));
    expect(en).toContain('Contact compliance');
    expect(es).toContain('No podemos terminar la configuración hasta que se apruebe tu licencia.');
    expect(es).toContain('Contactar a cumplimiento');
  });

  test('OrgBranchPanel — the universal (Primerica-free) branch body translates, with NO Primerica leak in either locale', () => {
    const props = { orgContext: buildOrgContext(OrgType.EXTERNAL) };
    const en = textOf(renderEn(OrgBranchPanel, props));
    const es = textOf(renderEs(OrgBranchPanel, props));
    expect(en).toContain("You're building independently.".replace("'", "’"));
    expect(es).toContain('Estás construyendo de forma independiente.');
    expect(en).not.toMatch(/primerica/i);
    expect(es).not.toMatch(/primerica/i);
  });

  // T-57 RG8 (i18n; server-i18n-leak) — `org-gate.ts`'s `buildOrgContext` used to bake hardcoded
  // English `label`/`caption` into the Primerica branch's solution-number field, with no path to
  // Spanish. `OrgStep.tsx` now passes `useLocale().locale` through, so a Spanish rep genuinely sees
  // the label + "not verified" caption in Spanish, not English.
  test('OrgBranchPanel — Primerica branch solution-number label + caption render real Spanish (not English)', () => {
    const en = textOf(renderEn(OrgBranchPanel, { orgContext: buildOrgContext(OrgType.PRIMERICA, 'en'), solutionNumber: '' }));
    const es = textOf(renderEs(OrgBranchPanel, { orgContext: buildOrgContext(OrgType.PRIMERICA, 'es'), solutionNumber: '' }));
    expect(en).toContain('Solution number');
    expect(en).toMatch(/Not verified/);
    expect(es).toContain('Número de solución');
    expect(es).toMatch(/No verificado/i);
    expect(es).not.toMatch(/solution number/i);
    expect(es).not.toMatch(/not verified/i);
  });

  test('GdprConsentStep — headline, lede, and the not-pre-selected caption translate (the GDPR legal consent statement itself stays the single fixed EN string, by design)', () => {
    const props = { consented: false };
    const en = textOf(renderEn(GdprConsentStep, props));
    const es = textOf(renderEs(GdprConsentStep, props));
    expect(en).toContain('Your data, your consent');
    expect(en).toContain('Not pre-selected — this is your explicit choice.');
    expect(es).toContain('Tus datos, tu consentimiento');
    expect(es).toContain('No está preseleccionado — esta es tu elección explícita.');
    // The GDPR statutory consent text is intentionally NOT translated (same fixed record in both
    // locales) — proven present, unchanged, in both renders.
    expect(en).toContain('I consent to Harvest processing my personal data, per GDPR and the Privacy Policy.');
    expect(es).toContain('I consent to Harvest processing my personal data, per GDPR and the Privacy Policy.');
  });

  test('IntensityDial — headline, all three position labels + consequences, and the pick-a-level prompt translate', () => {
    const en = textOf(renderEn(IntensityDial, { value: null }));
    const es = textOf(renderEs(IntensityDial, { value: null }));
    expect(en).toContain('How hard should your agents work while you live your life?');
    expect(en).toContain('Low');
    expect(en).toContain('Medium');
    expect(en).toContain('High');
    expect(en).toContain('Pick a level to see what your agents will and won');
    expect(es).toContain('¿Con qué intensidad deben trabajar tus agentes mientras vives tu vida?');
    expect(es).toContain('Baja');
    expect(es).toContain('Media');
    expect(es).toContain('Alta');
    expect(es).toContain('Elige un nivel para ver qué harán y qué no harán tus agentes.');

    const enHigh = textOf(renderEn(IntensityDial, { value: IntensitySetting.HIGH }));
    const esHigh = textOf(renderEs(IntensityDial, { value: IntensitySetting.HIGH }));
    expect(enHigh).toContain('Your agents work harder and faster');
    expect(esHigh).toContain('Tus agentes trabajan más fuerte y más rápido');
  });

  test('First48Handoff — headline, lede, and CTA translate', () => {
    const en = textOf(renderEn(First48Handoff, {}));
    const es = textOf(renderEs(First48Handoff, {}));
    expect(en).toContain('Your field is planted.');
    expect(en).toContain('Show me Today');
    expect(es).toContain('Tu campo está sembrado.');
    expect(es).toContain('Mostrarme Hoy');
  });

  test('OutreachConsentToggle — the question and caption translate (unlike GDPR, this is ordinary consent copy, not statutory text)', () => {
    const en = textOf(renderEn(OutreachConsentToggle, { value: false }));
    const es = textOf(renderEs(OutreachConsentToggle, { value: false }));
    expect(en).toContain('May your agents reference your why in your outreach?');
    expect(en).toContain('You can change this any time.');
    expect(es).toContain('¿Pueden tus agentes mencionar tu porqué cuando se comunican con tus contactos?');
    expect(es).not.toContain('May your agents reference');
  });

  test('SevenSeedStepper — the seven level names + state words feeding each seed\'s accessible name translate', () => {
    const props = { filledLevels: [SevenWhysLevel.GOAL], pulsingLevel: SevenWhysLevel.URGENCY };
    const en = renderEn(SevenSeedStepper, props);
    const es = renderEs(SevenSeedStepper, props);
    expect(en).toContain('aria-label="Goal: complete"');
    expect(en).toContain('aria-label="Urgency: staying here a little longer"');
    expect(en).toContain('aria-label="History: not yet"');
    expect(es).toContain('aria-label="Meta: completo"');
    expect(es).toContain('aria-label="Urgencia: quedándose aquí un poco más"');
    expect(es).toContain('aria-label="Historia: todavía no"');
  });

  test('SevenWhysConversation — the answer label, "agent is thinking" aria, and Continue translate', () => {
    const turn: SevenWhysRenderedTurn = {
      filledLevels: [],
      pulsingLevel: null,
      question: 'What do you want most from building this?',
      acknowledgment: null,
      reprompt: false,
      complete: false,
      anchorStatement: null,
    };
    const enHtml = renderEn(SevenWhysConversation, { turn, answer: 'a real answer', typing: true });
    const esHtml = renderEs(SevenWhysConversation, { turn, answer: 'a real answer', typing: true });
    const en = textOf(enHtml);
    const es = textOf(esHtml);
    expect(en).toContain('Your answer');
    expect(en).toContain('Continue');
    expect(enHtml).toContain('aria-label="Your agent is thinking"');
    expect(es).toContain('Tu respuesta');
    expect(es).toContain('Continuar');
    expect(esHtml).toContain('aria-label="Tu agente está pensando"');
    expect(es).not.toContain('Your answer');
  });
});
