// T-57 R3c-2 (findings m4 + B-M5). Before this fix, `ContactControls.tsx` rendered exactly TWO
// per-contact agent controls (pause / do-not-contact) with ZERO i18n (findings B-M5: ternary button
// labels, template-literal aria-labels, and setState() string args — the three shapes
// `guard-no-literals-in-components.mjs`'s current AST walk cannot see, so this file silently passed
// the build guard despite being 100% hardcoded EN). This proves:
//   (a) the THIRD control, "hand to manual mode" (master-spec §9.4), now renders alongside the
//       original two, with real `role="switch"`/`aria-checked` semantics and a ≥44px touch target.
//   (b) every string in the component — all three toggle labels/aria-labels, the group aria-label,
//       and (via source-scan, since this repo's Jest env has no jsdom to click-and-observe) every
//       confirmation/error message — resolves through the catalog, in BOTH languages, under the new
//       `contactControls.*` namespace.
//   (c) the component still calls the SAME real `/api/contacts/controls` route, now with a third
//       independent `manualMode` field.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ContactControls from '@/app/inbox/components/ContactControls';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ContactControls as never, props));

function esRender(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(ContactControls as never, props)
    )
  );
}

const baseProps = { contactId: 'c-1', contactName: 'Jordan Vega', agentsPaused: false, doNotContact: false };

describe('ContactControls — the third control, "hand to manual mode" (§9.4, findings m4)', () => {
  test('renders alongside the original pause + do-not-contact controls, all three as real switches', () => {
    const html = render(baseProps);
    expect(textOf(html)).toContain('Pause agents');
    expect(textOf(html)).toContain('Do not contact');
    expect(textOf(html)).toContain('Hand to manual mode');
    expect(html.match(/role="switch"/g) ?? []).toHaveLength(3);
  });

  test('reflects the ON state distinctly for each of the three controls (aria-checked + on-label)', () => {
    const html = render({ ...baseProps, agentsPaused: true, doNotContact: true, manualMode: true });
    const text = textOf(html);
    expect(text).toContain('Agents paused');
    expect(text).toContain('Do not contact — set');
    expect(text).toContain('Manual mode — on');
    expect(html.match(/aria-checked="true"/g) ?? []).toHaveLength(3);
  });

  test('manualMode defaults to false for every existing caller that has not been updated to pass it', () => {
    const html = render(baseProps); // no manualMode prop supplied at all
    expect(textOf(html)).toContain('Hand to manual mode');
    expect(textOf(html)).not.toContain('Manual mode — on');
  });

  test('the manual-mode toggle meets the 44px touch-target floor via its own dedicated class (not the pre-existing, grandfathered 36px .controlToggle)', () => {
    const html = render(baseProps);
    expect(html).toMatch(/class="controlToggleManual[^"]*"[^>]*>\s*Hand to manual mode/);
  });

  test('the group aria-label names the contact', () => {
    const html = render(baseProps);
    expect(html).toContain('aria-label="Agent controls for Jordan Vega"');
  });

  test('each control carries its own contact-named aria-label', () => {
    const html = render(baseProps);
    expect(html).toContain('aria-label="Pause agents for Jordan Vega"');
    expect(html).toContain('aria-label="Do not contact Jordan Vega"');
    // React HTML-escapes the apostrophe in an attribute value (&#x27;) — assert against that
    // real escaped form rather than the raw source string.
    expect(html).toContain('aria-label="Hand Jordan Vega&#x27;s thread to manual mode"');
  });
});

describe('ContactControls — genuine ES rendering of ALL three controls (findings B-M5: was ZERO i18n)', () => {
  test('renders real Spanish labels, not a silent EN fallback', () => {
    const html = esRender(baseProps);
    const text = textOf(html);
    expect(text).toContain('Pausar agentes');
    expect(text).toContain('No contactar');
    expect(text).toContain('Pasar a modo manual');
    expect(text).not.toContain('Pause agents');
    expect(text).not.toContain('Hand to manual mode');
  });

  test('the ON-state Spanish labels are real translations too', () => {
    const html = esRender({ ...baseProps, agentsPaused: true, doNotContact: true, manualMode: true });
    const text = textOf(html);
    expect(text).toContain('Agentes en pausa');
    expect(text).toContain('No contactar — activado');
    expect(text).toContain('Modo manual — activado');
  });

  test('the Spanish group aria-label names the contact', () => {
    const html = esRender(baseProps);
    expect(html).toContain('aria-label="Controles del agente para Jordan Vega"');
  });
});

describe('ContactControls — real backend wiring: still the SAME /api/contacts/controls route, now a third independent field', () => {
  const src = readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'inbox', 'components', 'ContactControls.tsx'), 'utf8');

  test('calls the real route (no demo/mock fallback)', () => {
    expect(src).toMatch(/fetch\('\/api\/contacts\/controls',/);
  });

  test('every confirmation and error string resolves through t(\'contactControls.*\') — zero raw literals remain (findings B-M5)', () => {
    // The three ternary-branch shapes findings B-M5 named explicitly: button labels, template
    // aria-labels, and setState() string args. None of them should be a bare quoted English string
    // anymore — every one should route through `t('contactControls....`.
    expect(src).not.toMatch(/setConfirmation\('[A-Za-z]/);
    expect(src).not.toMatch(/aria-label=\{`[A-Za-z]/); // no un-translated template aria-label left
    expect(src.match(/t\('contactControls\./g)?.length ?? 0).toBeGreaterThanOrEqual(10);
  });

  test('sends manualMode as its own independent field (never bundled with the other two in one call)', () => {
    expect(src).toMatch(/type ControlField = 'agentsPaused' \| 'doNotContact' \| 'manualMode'/);
    expect(src).toMatch(/body:\s*JSON\.stringify\(\{\s*contactId,\s*\[field\]:\s*next\s*\}\)/);
  });
});
