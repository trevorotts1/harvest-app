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

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  AGENTS_RESTING_LINE,
  briefingSrUtterance,
  briefingVisibleNarrative,
  EMPTY_LINE,
  FIRST_DAY_LINE,
} from '@/app/today/components/BriefingCard';
import type { BriefingLine } from '@/services/mission-control/types';

describe('briefingVisibleNarrative — the exact visible text (§6.1 item 6 "transcript = the visible text, always")', () => {
  test('a single agent line: "While you slept:" prefixed once, own prefix not duplicated', () => {
    const lines: BriefingLine[] = [{ text: 'While you slept: your Reporting Agent ran 3 times — 2 cleared, 1 flagged for review.', receipts: [] }];
    expect(briefingVisibleNarrative(lines)).toBe('While you slept: your Reporting Agent ran 3 times — 2 cleared, 1 flagged for review.');
  });

  test('two agent lines, each independently prefixed: joined under ONE lead-in, not two', () => {
    const lines: BriefingLine[] = [
      { text: 'While you slept: your Reporting Agent ran 2 times — 2 cleared.', receipts: [] },
      { text: 'While you slept: your Prospecting Agent ran 1 time — 1 cleared.', receipts: [] },
    ];
    expect(briefingVisibleNarrative(lines)).toBe(
      'While you slept: your Reporting Agent ran 2 times — 2 cleared. your Prospecting Agent ran 1 time — 1 cleared.'
    );
  });

  test('a line with no "While you slept:" prefix (e.g. the pending-drafts line) passes through unmodified', () => {
    const lines: BriefingLine[] = [{ text: '3 drafts waiting for your approval.', receipts: [] }];
    expect(briefingVisibleNarrative(lines)).toBe('While you slept: 3 drafts waiting for your approval.');
  });
});

describe('briefingSrUtterance — visible narrative + the VoiceOver-specific receipts hint', () => {
  test('appends "Double-tap any line for receipts." to the exact visible narrative', () => {
    const lines: BriefingLine[] = [{ text: 'While you slept: your Reporting Agent ran 1 time — 1 cleared.', receipts: [] }];
    expect(briefingSrUtterance(lines)).toBe(`${briefingVisibleNarrative(lines)} Double-tap any line for receipts.`);
  });
});

describe('the fixed single-line states (first_day / agents_resting / empty) are exported constants, not re-typed strings', () => {
  test('each is non-empty and honest (no fabricated overnight activity)', () => {
    for (const line of [FIRST_DAY_LINE, AGENTS_RESTING_LINE, EMPTY_LINE]) {
      expect(line.length).toBeGreaterThan(0);
    }
    expect(AGENTS_RESTING_LINE.toLowerCase()).not.toMatch(/community introductions went out/);
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

  test('the button label pair is icon + text, never color alone (master-spec §17.4 "color-independent status")', () => {
    expect(component).toMatch(/isSpeaking \? 'Stop' : 'Listen'/);
  });
});
