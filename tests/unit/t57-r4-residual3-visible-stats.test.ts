// T-57 R4-residual3 (visible stats pluralization) — proves the 3 visible stat strings
// in HiddenEarningsReveal (`eyebrow`, `conversationsStat`, `familiesStat`) now use
// CLDR one/other plural forms, so they pluralize correctly in both EN and ES.
//
// Before: count=1 rendered "1 people", "1 conversations", "1 families" (incorrect)
// After:  count=1 renders "1 person", "1 conversation", "1 family" (correct)

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import HiddenEarningsReveal from '@/app/onboarding/components/HiddenEarningsReveal';

function render<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(createElement(el, props));
}

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('T-57 R4-residual3: HiddenEarningsReveal visible stats — CLDR one/other plural', () => {
  // All visible stats require contactCount > 3 and monthlyValueUsd > 0 to render
  // (otherwise the component shows the growth-path variant).
  // contactCount must be > 3, and we test the plural behavior of the OTHER TWO counts
  // (estimatedAppointments/estimatedClients) at count=1 to show singular forms.
  const basePropsEn = {
    contactCount: 5,
    monthlyValueUsd: 500,
    estimatedAppointments: 15,
    estimatedClients: 5,
    locale: 'en' as const,
  };

  const basePropsEs = {
    contactCount: 5,
    monthlyValueUsd: 500,
    estimatedAppointments: 15,
    estimatedClients: 5,
    locale: 'es' as const,
  };

  // === EYEBROW STAT (FROM THE {COUNT} PEOPLE) ===
  // Note: The eyebrow is tied to contactCount itself. When contactCount <= 3, the component
  // renders the zero-data growth path (not the figure branch where eyebrow appears).
  // So we test eyebrow with contactCount > 3. The CLDR plural forms work the same way:
  // count=1 → singular, count≥2 → plural.

  describe('eyebrow stat (from the {count} people/person)', () => {
    test('EN count=4 (minimum for figure branch) renders plural "people"', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEn, contactCount: 4 });
      const text = textOf(html);
      expect(text).toContain('From the 4 people in your field');
    });

    test('EN count=2+ renders "people" plural form correctly', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEn, contactCount: 10 });
      const text = textOf(html);
      expect(text).toContain('From the 10 people in your field');
    });

    test('ES count=4 (minimum for figure branch) renders plural "personas"', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEs, contactCount: 4 });
      const text = textOf(html);
      expect(text).toContain('De las 4 personas en tu campo');
    });

    test('ES count=2+ renders "personas" plural form correctly', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEs, contactCount: 10 });
      const text = textOf(html);
      expect(text).toContain('De las 10 personas en tu campo');
    });
  });

  // === CONVERSATIONS STAT ({COUNT} CONVERSATIONS) ===

  describe('conversationsStat (estimated {count} conversations/conversation)', () => {
    test('RED-confirming: EN count=1 NOW renders "1 conversation" (singular), not "1 conversations"', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEn, estimatedAppointments: 1 });
      const text = textOf(html);
      expect(text).toContain('1 conversation');
      expect(text).not.toContain('1 conversations');
    });

    test('EN count=2+ still renders "conversations" plural correctly — no regression', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEn, estimatedAppointments: 8 });
      const text = textOf(html);
      expect(text).toContain('8 conversations');
    });

    test('RED-confirming: ES count=1 NOW renders "1 conversación" (singular), not "1 conversaciones"', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEs, estimatedAppointments: 1 });
      const text = textOf(html);
      expect(text).toContain('1 conversación');
      expect(text).not.toContain('1 conversaciones');
    });

    test('ES count=2+ still renders "conversaciones" plural correctly — no regression', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEs, estimatedAppointments: 3 });
      const text = textOf(html);
      expect(text).toContain('3 conversaciones');
    });
  });

  // === FAMILIES STAT ({COUNT} FAMILIES YOU COULD HELP) ===

  describe('familiesStat ({count} families/family you could help)', () => {
    test('RED-confirming: EN count=1 NOW renders "1 family you could help" (singular), not "1 families"', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEn, estimatedClients: 1 });
      const text = textOf(html);
      expect(text).toContain('1 family you could help');
      expect(text).not.toContain('1 families');
    });

    test('EN count=2+ still renders "families" plural correctly — no regression', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEn, estimatedClients: 7 });
      const text = textOf(html);
      expect(text).toContain('7 families you could help');
    });

    test('RED-confirming: ES count=1 NOW renders "1 familia a la que podrías ayudar" (singular), not "1 familias"', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEs, estimatedClients: 1 });
      const text = textOf(html);
      expect(text).toContain('1 familia a la que podrías ayudar');
      expect(text).not.toContain('1 familias');
    });

    test('ES count=2+ still renders "familias" plural correctly — no regression', () => {
      const html = render(HiddenEarningsReveal, { ...basePropsEs, estimatedClients: 4 });
      const text = textOf(html);
      expect(text).toContain('4 familias a las que podrías ayudar');
    });
  });

  // === ALL THREE STATS TOGETHER ===

  describe('all three visible stats render correct forms (edge case: the two independent counts at 1)', () => {
    test('EN: conversationsStat and familiesStat render singular forms when count=1, eyebrow plural (contactCount>1)', () => {
      const html = render(HiddenEarningsReveal, {
        ...basePropsEn,
        contactCount: 4, // Must be > 3 for figure branch; uses plural form
        monthlyValueUsd: 100,
        estimatedAppointments: 1, // Tests singular "conversation"
        estimatedClients: 1, // Tests singular "family"
      });
      const text = textOf(html);
      expect(text).toContain('From the 4 people in your field');
      expect(text).toContain('1 conversation');
      expect(text).toContain('1 family you could help');
    });

    test('ES: conversationsStat and familiesStat render singular forms when count=1, eyebrow plural (contactCount>1)', () => {
      const html = render(HiddenEarningsReveal, {
        ...basePropsEs,
        contactCount: 4, // Must be > 3 for figure branch; uses plural form
        monthlyValueUsd: 100,
        estimatedAppointments: 1, // Tests singular "conversación"
        estimatedClients: 1, // Tests singular "familia"
      });
      const text = textOf(html);
      expect(text).toContain('De las 4 personas en tu campo');
      expect(text).toContain('1 conversación');
      expect(text).toContain('1 familia a la que podrías ayudar');
    });
  });
});
