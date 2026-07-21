// T-52 (WCAG 2.2 AA — master-spec §17.4, uiux §6.1 item 6: "TTS briefing: the 'listen' affordance
// plays the briefing as audio (system TTS in v1) — an accessibility feature that seeds the Phase-2
// Voice Check-In; transcript = the visible text, always."). T-51 parity found this entirely absent
// on the daily briefing. Two complementary checks:
//   (a) the load-bearing invariant — the TTS transcript is BUILT FROM the exact same strings that
//       render on screen (proven by unit-testing the shared pure helpers directly, same convention
//       as ClosePhase.recapLine / ShiftView.applyOptimisticAction — this repo's Jest config is
//       `testEnvironment: 'node'`, so `window.speechSynthesis` itself cannot be exercised here);
//   (b) a source-level check that the component actually calls the Web Speech API (SpeechSynthesis)
//       — the class of check mission-control-ui.test.ts's "(e) Today primary CTA" block already
//       establishes as this repo's convention for behavior that has no render-time DOM signal.
//
// T-57 BLOCKER-B5/B3 fix — `briefingVisibleNarrative`/`briefingSrUtterance` now take a `t` function
// (the wrapping "While you slept: .../Double-tap..." phrases are genuinely locale-aware, no longer
// hardcoded English) and the three fixed single-line states are catalog keys, not exported bare
// string constants — this file now reads them straight from the real `en` catalog via `t()`, which
// is exactly what a genuine caller does too.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { briefingSrUtterance, briefingVisibleNarrative } from '@/app/today/components/BriefingCard';
import { t } from '@/lib/i18n/catalog';
import type { BriefingLine } from '@/services/mission-control/types';

const tEn = (key: string, vars?: Record<string, string | number>) => t('en', key, vars);

describe('briefingVisibleNarrative — the exact visible text (§6.1 item 6 "transcript = the visible text, always")', () => {
  test('a single agent line: "While you slept:" prefixed once, own prefix not duplicated', () => {
    const lines: BriefingLine[] = [{ text: 'While you slept: your Reporting Agent ran 3 times — 2 cleared, 1 flagged for review.', receipts: [] }];
    expect(briefingVisibleNarrative(lines, tEn)).toBe('While you slept: your Reporting Agent ran 3 times — 2 cleared, 1 flagged for review.');
  });

  test('two agent lines, each independently prefixed: joined under ONE lead-in, not two', () => {
    const lines: BriefingLine[] = [
      { text: 'While you slept: your Reporting Agent ran 2 times — 2 cleared.', receipts: [] },
      { text: 'While you slept: your Prospecting Agent ran 1 time — 1 cleared.', receipts: [] },
    ];
    expect(briefingVisibleNarrative(lines, tEn)).toBe(
      'While you slept: your Reporting Agent ran 2 times — 2 cleared. your Prospecting Agent ran 1 time — 1 cleared.'
    );
  });

  test('a line with no "While you slept:" prefix (e.g. the pending-drafts line) passes through unmodified', () => {
    const lines: BriefingLine[] = [{ text: '3 drafts waiting for your approval.', receipts: [] }];
    expect(briefingVisibleNarrative(lines, tEn)).toBe('While you slept: 3 drafts waiting for your approval.');
  });

  test('a Spanish-lead-in line is also de-duplicated (forward-compatible widening — T-57 BLOCKER-B5)', () => {
    const lines: BriefingLine[] = [{ text: 'Mientras dormías: tu Agente de Prospección hizo 1 intento.', receipts: [] }];
    expect(briefingVisibleNarrative(lines, tEn)).toBe('While you slept: tu Agente de Prospección hizo 1 intento.');
  });

  test('genuinely renders in Spanish under the es locale — the wrapping phrase, not just the substituted content', () => {
    const tEs = (key: string, vars?: Record<string, string | number>) => t('es', key, vars);
    const lines: BriefingLine[] = [{ text: 'While you slept: tu Agente de Reportes se ejecutó 1 vez.', receipts: [] }];
    expect(briefingVisibleNarrative(lines, tEs)).toBe('Mientras dormías: tu Agente de Reportes se ejecutó 1 vez.');
  });
});

describe('briefingSrUtterance — visible narrative + the VoiceOver-specific receipts hint', () => {
  test('appends the receipts hint to the exact visible narrative', () => {
    const lines: BriefingLine[] = [{ text: 'While you slept: your Reporting Agent ran 1 time — 1 cleared.', receipts: [] }];
    expect(briefingSrUtterance(lines, tEn)).toBe(`${briefingVisibleNarrative(lines, tEn)} Double-tap any line for receipts.`);
  });
});

describe('the fixed single-line states (first_day / agents_resting / empty) are real catalog keys, EN/ES both real', () => {
  test('each is non-empty and honest (no fabricated overnight activity), in both locales', () => {
    for (const key of ['today.briefingCard.firstDayLine', 'today.briefingCard.agentsRestingLine', 'today.briefingCard.emptyLine']) {
      expect(t('en', key).length).toBeGreaterThan(0);
      expect(t('es', key).length).toBeGreaterThan(0);
      // A missing/untranslated ES key would silently fall back to the EN string (catalog.ts's own
      // documented fallback) — asserting the two differ proves this is a REAL Spanish translation,
      // not an English string masquerading as one under the ES locale.
      expect(t('es', key)).not.toBe(t('en', key));
    }
    expect(t('en', 'today.briefingCard.agentsRestingLine').toLowerCase()).not.toMatch(/community introductions went out/);
  });
});

describe('BriefingCard — "listen" (TTS) affordance actually calls the Web Speech API', () => {
  const component = readFileSync(
    path.join(__dirname, '..', '..', 'src', 'app', 'today', 'components', 'BriefingCard.tsx'),
    'utf8'
  );

  test('uses SpeechSynthesisUtterance + window.speechSynthesis.speak (not a stub/no-op)', () => {
    expect(component).toContain('new SpeechSynthesisUtterance(');
    expect(component).toContain('window.speechSynthesis.speak(');
  });

  test('guards for browser support before rendering the affordance (never throws where unsupported)', () => {
    expect(component).toMatch(/'speechSynthesis' in window/);
    expect(component).toMatch(/ttsSupported\s*&&/);
  });

  test('the listen button toggles to Stop / cancels speech (never leaves a dangling utterance on unmount)', () => {
    expect(component).toContain('window.speechSynthesis.cancel()');
    expect(component).toMatch(/aria-pressed=\{isSpeaking\}/);
  });

  test('the button label pair is icon + text, never color alone (master-spec §17.4 "color-independent status") — now catalog-driven, not a hardcoded EN ternary (T-57 BLOCKER-B5)', () => {
    expect(component).toMatch(/isSpeaking \? t\('today\.briefingCard\.stopCta'\) : t\('today\.briefingCard\.listenCta'\)/);
    expect(component).not.toMatch(/isSpeaking \? 'Stop' : 'Listen'/);
  });
});
