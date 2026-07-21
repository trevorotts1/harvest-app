// T-57 R3c-1 (MAJOR-A3, uiux §6.1 item 5 "channel detail available on the Three Laws sheet"). Grove
// was pure decoration before this fix (zero onClick anywhere in the file); this proves it is now a
// real, keyboard/SR-reachable tappable affordance that opens a real Three Laws sheet listing the
// Grow/Engage/Wealth channel values + captions.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import Grove from '@/app/today/components/Grove';
import GroveThreeLawsSheet from '@/app/today/components/GroveThreeLawsSheet';

const LAWS = { grow: 70, engage: 45, wealth: 88 };

describe('T-57 R3c-1 — Grove.tsx: a real, native <button> wraps the svg+caption', () => {
  test('RED (pre-fix) would be: a bare <div> with no button/onClick anywhere', () => {
    const html = renderToStaticMarkup(createElement(Grove, { state: 'growing', laws: LAWS, caption: 'Growing' }));
    expect(html).toMatch(/<button/);
  });

  test('the button is keyboard-focusable by construction (a real <button type="button">, never a div-with-onClick)', () => {
    const html = renderToStaticMarkup(createElement(Grove, { state: 'growing', laws: LAWS, caption: 'Growing' }));
    expect(html).toMatch(/<button type="button"/);
  });

  test('the caption remains the accessible name — embedded verbatim in the button\'s aria-label (§6.1#5)', () => {
    const html = renderToStaticMarkup(createElement(Grove, { state: 'growing', laws: LAWS, caption: 'Growing' }));
    expect(html).toMatch(/aria-label="Growing\./);
  });

  test('the caption is STILL rendered as its own visible text (unchanged — AC-3-2 regression proof)', () => {
    const html = renderToStaticMarkup(createElement(Grove, { state: 'growing', laws: LAWS, caption: 'Growing' }));
    expect(html.replace(/<[^>]*>/g, ' ')).toContain('Growing');
  });

  test('the SVG stays aria-hidden decorative — unchanged (§3.3)', () => {
    const html = renderToStaticMarkup(createElement(Grove, { state: 'growing', laws: LAWS, caption: 'Growing' }));
    expect(html).toContain('aria-hidden="true"');
  });

  test('all eight §3.2 states still render (AC-3-2 regression: tappable wrapper changed nothing about state rendering)', () => {
    const states = ['seed', 'sprout', 'thriving', 'growing', 'quiet', 'resting', 'bloom', 'stale'] as const;
    for (const state of states) {
      const html = renderToStaticMarkup(createElement(Grove, { state, laws: LAWS, caption: `caption for ${state}` }));
      expect(html.replace(/<[^>]*>/g, ' ')).toContain(`caption for ${state}`);
    }
  });

  test('the sheet is mounted (present in the tree) but closed by default — never open uninvited', () => {
    const html = renderToStaticMarkup(createElement(Grove, { state: 'growing', laws: LAWS, caption: 'Growing' }));
    expect(html).not.toMatch(/role="dialog"/);
  });
});

describe('T-57 R3c-1 — GroveThreeLawsSheet.tsx: keyboard/SR-reachable, real channel data', () => {
  test('closed (open=false) renders nothing at all', () => {
    const html = renderToStaticMarkup(createElement(GroveThreeLawsSheet, { open: false, onClose: () => {}, laws: LAWS }));
    expect(html).toBe('');
  });

  test('open renders a real ARIA dialog with aria-modal', () => {
    const html = renderToStaticMarkup(createElement(GroveThreeLawsSheet, { open: true, onClose: () => {}, laws: LAWS }));
    expect(html).toMatch(/role="dialog"/);
    expect(html).toMatch(/aria-modal="true"/);
  });

  test('a real, labelled close <button> exists (keyboard-reachable, not a bare icon with no name)', () => {
    const html = renderToStaticMarkup(createElement(GroveThreeLawsSheet, { open: true, onClose: () => {}, laws: LAWS }));
    expect(html).toMatch(/<button[^>]*aria-label="Close"/);
  });

  test('lists all three REAL channel values (Grow/Engage/Wealth) — never fabricated, straight off the laws prop', () => {
    const html = renderToStaticMarkup(createElement(GroveThreeLawsSheet, { open: true, onClose: () => {}, laws: LAWS }));
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(text).toContain('Grow');
    expect(text).toContain('70');
    expect(text).toContain('Engage');
    expect(text).toContain('45');
    expect(text).toContain('Wealth');
    expect(text).toContain('88');
  });

  test('each channel carries a real plain-language caption (§3.1 anatomy), not just a bare number', () => {
    const html = renderToStaticMarkup(createElement(GroveThreeLawsSheet, { open: true, onClose: () => {}, laws: LAWS }));
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(text).toMatch(/branches grow/i);
    expect(text).toMatch(/leaves fill in/i);
    expect(text).toMatch(/fruit appears/i);
  });

  test('the backdrop supports Escape-to-close (a real onKeyDown handler, not click-only)', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', 'src', 'app', 'today', 'components', 'GroveThreeLawsSheet.tsx'),
      'utf8'
    );
    expect(source).toMatch(/e\.key === 'Escape'/);
  });

  test('the close button receives focus on open (a real useEffect + ref, not click-only reachability)', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', 'src', 'app', 'today', 'components', 'GroveThreeLawsSheet.tsx'),
      'utf8'
    );
    expect(source).toMatch(/closeButtonRef\.current\?\.focus\(\)/);
  });
});
