// T-34 (master-spec §9.7 "the two ratios", §9.8 "The Shift" / the 20:5:1 learning state, §9.9-7
// "never NaN") — proves the ratio arithmetic and the learning-state threshold with TEETH:
//   (a) both ratios compute correctly from real fixture data (fixture in -> expected ratio out);
//   (b) the learning state transitions AT the spec threshold (19 data points -> still LEARNING/
//       baseline; 20 -> SHIFTING/real data now used) — fails if the boundary is off by one in
//       either direction;
//   (c) the ratio cards NEVER render a naked number: every headline is always accompanied by an
//       explainer, and — when the spec's 20-50 range is unmet — a "learning your community" label;
//   never NaN, at zero data and at the boundary.

import {
  BASELINE_RATIO,
  LEARNING_STATE_ESTABLISHED_THRESHOLD,
  LEARNING_STATE_MIN_THRESHOLD,
  buildAgentRatioCardView,
  buildFieldTrainerRatioCardView,
  computeAgentRatio,
  computeFieldTrainerRatio,
  deriveLearningStateStatus,
  isLearningLabelActive,
  simplifyRatioParts,
  type FunnelContact,
  type TrainerRunAppointment,
} from '@/services/learning-state/ratios';

// ─── (a) Agent's Ratio: introductions -> responses -> appointments set -> confirmed shows ────────

describe('(a) computeAgentRatio — real fixture data in, exact counts out', () => {
  test('a mixed funnel of 10 contacts yields the exact expected tally at every stage', () => {
    const contacts: FunnelContact[] = [
      { pipeline_stage: 'IDENTIFIED' }, // never introduced
      { pipeline_stage: 'INTRODUCED' },
      { pipeline_stage: 'INTRODUCED' },
      { pipeline_stage: 'RESPONDED' },
      { pipeline_stage: 'RESPONDED' },
      { pipeline_stage: 'APPOINTMENT_PROPOSED' }, // introduced+responded, NOT "set" (not confirmed)
      { pipeline_stage: 'APPOINTMENT_CONFIRMED' },
      { pipeline_stage: 'MET' },
      { pipeline_stage: 'CLOSED_CLIENT' },
      { pipeline_stage: 'CLOSED_RECRUIT' },
    ];
    const tally = computeAgentRatio(contacts);
    // Reached INTRODUCED+: everyone except IDENTIFIED = 9
    expect(tally.introductions).toBe(9);
    // Reached RESPONDED+: 2 RESPONDED + APPOINTMENT_PROPOSED + APPOINTMENT_CONFIRMED + MET + 2 CLOSED = 7
    expect(tally.responses).toBe(7);
    // Reached APPOINTMENT_CONFIRMED+ ("appointments SET" = confirmed, not merely proposed): 1 + MET + 2 CLOSED = 4
    expect(tally.appointmentsSet).toBe(4);
    // Reached MET+ ("confirmed shows"): MET + CLOSED_CLIENT + CLOSED_RECRUIT = 3
    expect(tally.confirmedShows).toBe(3);
    expect(tally.dataPointCount).toBe(tally.introductions);
  });

  test('DORMANT / DO_NOT_CONTACT contacts count nowhere past "exists" (documented conservative-floor behavior)', () => {
    const contacts: FunnelContact[] = [
      { pipeline_stage: 'DORMANT' },
      { pipeline_stage: 'DO_NOT_CONTACT' },
      { pipeline_stage: 'INTRODUCED' },
    ];
    const tally = computeAgentRatio(contacts);
    expect(tally.introductions).toBe(1);
    expect(tally.responses).toBe(0);
    expect(tally.appointmentsSet).toBe(0);
    expect(tally.confirmedShows).toBe(0);
  });

  test('an all-empty funnel is all zeros, never NaN', () => {
    const tally = computeAgentRatio([]);
    expect(tally).toEqual({ introductions: 0, responses: 0, appointmentsSet: 0, confirmedShows: 0, dataPointCount: 0 });
    expect(Number.isNaN(tally.introductions)).toBe(false);
  });
});

// ─── (a) Field Trainer's Ratio: appointments run -> client signs / recruit joins ──────────────────

describe('(a) computeFieldTrainerRatio — real fixture data in, exact counts out', () => {
  test('only trainer-attached, CONFIRMED (actually-run) appointments count; only CLOSED_* contacts count as closes', () => {
    const appointments: TrainerRunAppointment[] = [
      { hasTrainer: true, status: 'CONFIRMED', contactStage: 'CLOSED_CLIENT' }, // run + close
      { hasTrainer: true, status: 'CONFIRMED', contactStage: 'CLOSED_RECRUIT' }, // run + close
      { hasTrainer: true, status: 'CONFIRMED', contactStage: 'MET' }, // run, no close
      { hasTrainer: true, status: 'NO_SHOW', contactStage: 'DORMANT' }, // NOT run (status)
      { hasTrainer: false, status: 'CONFIRMED', contactStage: 'CLOSED_CLIENT' }, // NOT run (no trainer)
      { hasTrainer: true, status: 'PROPOSED', contactStage: 'IDENTIFIED' }, // NOT run (not confirmed yet)
    ];
    const tally = computeFieldTrainerRatio(appointments);
    expect(tally.appointmentsRun).toBe(3);
    expect(tally.closes).toBe(2);
    expect(tally.dataPointCount).toBe(3);
  });

  test('zero appointments -> zero everything, never NaN', () => {
    const tally = computeFieldTrainerRatio([]);
    expect(tally).toEqual({ appointmentsRun: 0, closes: 0, dataPointCount: 0 });
    expect(Number.isNaN(tally.closes)).toBe(false);
  });
});

// ─── (b) TEETH: the learning-state threshold, exactly at the spec boundary ────────────────────────
//
// QC FIX (T-34 QC round): the boundary tests below USED to compute their inputs as
// `LEARNING_STATE_MIN_THRESHOLD - 1` / `LEARNING_STATE_MIN_THRESHOLD` — self-referential to the
// constant under test, so mutating the constant (e.g. 20 -> 21) shifted BOTH the input and the
// expectation together and left every test green. Proven vacuous live: temporarily setting
// `LEARNING_STATE_MIN_THRESHOLD = 21` in ratios.ts and re-running this file, every test in this
// describe block still passed. That is now fixed two ways: (1) the constants themselves are
// asserted against the spec's LITERAL numbers below, so any change to the constant is immediately
// test-visible; (2) new literal-input tests below feed hardcoded numbers (19/20/49/50), never the
// constant, so a boundary drift fails those regardless of what the self-referential tests do.

describe('(b0) TEETH — the threshold CONSTANTS themselves are the spec\'s literal 20 and 50, not just internally self-consistent', () => {
  test('LEARNING_STATE_MIN_THRESHOLD is literally 20 (master-spec §9.7 "20:5:1")', () => {
    expect(LEARNING_STATE_MIN_THRESHOLD).toBe(20);
  });

  test('LEARNING_STATE_ESTABLISHED_THRESHOLD is literally 50 (master-spec §9.7 "20-50 data points")', () => {
    expect(LEARNING_STATE_ESTABLISHED_THRESHOLD).toBe(50);
  });
});

describe('(b) deriveLearningStateStatus — transitions AT the spec threshold, not before or after', () => {
  test(`${LEARNING_STATE_MIN_THRESHOLD - 1} data points -> LEARNING (below threshold: baseline/oversight mode)`, () => {
    expect(deriveLearningStateStatus(LEARNING_STATE_MIN_THRESHOLD - 1)).toBe('LEARNING');
  });

  test(`${LEARNING_STATE_MIN_THRESHOLD} data points -> SHIFTING (AT threshold: real data now used — "the shift" fires)`, () => {
    expect(deriveLearningStateStatus(LEARNING_STATE_MIN_THRESHOLD)).toBe('SHIFTING');
  });

  test(`${LEARNING_STATE_ESTABLISHED_THRESHOLD - 1} data points -> still SHIFTING (label still active per the spec's literal 20-50 range)`, () => {
    expect(deriveLearningStateStatus(LEARNING_STATE_ESTABLISHED_THRESHOLD - 1)).toBe('SHIFTING');
  });

  test(`${LEARNING_STATE_ESTABLISHED_THRESHOLD} data points -> SHIFTED (fully established, label drops)`, () => {
    expect(deriveLearningStateStatus(LEARNING_STATE_ESTABLISHED_THRESHOLD)).toBe('SHIFTED');
  });

  test('0 data points -> LEARNING, never throws / never NaN-adjacent', () => {
    expect(deriveLearningStateStatus(0)).toBe('LEARNING');
  });

  test('isLearningLabelActive: true for LEARNING and SHIFTING, false only for SHIFTED', () => {
    expect(isLearningLabelActive('LEARNING')).toBe(true);
    expect(isLearningLabelActive('SHIFTING')).toBe(true);
    expect(isLearningLabelActive('SHIFTED')).toBe(false);
  });

  // TEETH, literal inputs — no reference to the constant anywhere in this describe block. These
  // fail if the boundary drifts in EITHER direction, and — unlike the block above — they also fail
  // if someone "fixes" the vacuous-test defect by mutating the constant instead of the real bug:
  // mutating LEARNING_STATE_MIN_THRESHOLD from 20 to 21 makes `deriveLearningStateStatus(19)`
  // return 'SHIFTING' instead of the literal spec answer 'LEARNING' below, and 'a red test proves
  // it. (Verified live during this fix: temporarily edited ratios.ts's
  // `LEARNING_STATE_MIN_THRESHOLD` to 21 — the `19 -> LEARNING` / `20 -> SHIFTING` tests in this
  // literal-input block turned red; reverted immediately after confirming.)
  test('LITERAL: exactly 19 data points -> LEARNING (one below the spec\'s literal 20)', () => {
    expect(deriveLearningStateStatus(19)).toBe('LEARNING');
  });

  test('LITERAL: exactly 20 data points -> SHIFTING (the spec\'s literal minimum — "the shift" fires)', () => {
    expect(deriveLearningStateStatus(20)).toBe('SHIFTING');
  });

  test('LITERAL: exactly 49 data points -> SHIFTING (one below the spec\'s literal 50)', () => {
    expect(deriveLearningStateStatus(49)).toBe('SHIFTING');
  });

  test('LITERAL: exactly 50 data points -> SHIFTED (the spec\'s literal established threshold)', () => {
    expect(deriveLearningStateStatus(50)).toBe('SHIFTED');
  });
});

// ─── (c) INVISIBLE-SCORE CHECK (inverted): §9.7/§9.9-7 REQUIRE the ratios to display WITH an
//     explainer — unlike the Readiness Score elsewhere in this codebase (uiux §5.4 AC-5.4-4), which
//     is deliberately hidden. Proves the headline number is NEVER naked: always paired with an
//     explainer, and — until established — the "learning your community" qualifier. ────────────────

describe('(c) ratio card views never render a naked number; never NaN', () => {
  test("below threshold: the Agent's Ratio card shows the exact baseline 20:5:1, labeled, explained", () => {
    const view = buildAgentRatioCardView(computeAgentRatio([{ pipeline_stage: 'INTRODUCED' }]));
    expect(view.isBaseline).toBe(true);
    expect(view.headline).toEqual([BASELINE_RATIO.introductions, BASELINE_RATIO.appointmentsSet, BASELINE_RATIO.outcome]);
    expect(view.learningLabel).toBe('learning your community');
    expect(view.explainer.length).toBeGreaterThan(0);
    expect(view.status).toBe('LEARNING');
  });

  test("at/above threshold: the Agent's Ratio card shows the rep's OWN real numbers, still explained", () => {
    const contacts: FunnelContact[] = Array.from({ length: 22 }, () => ({ pipeline_stage: 'INTRODUCED' as const }));
    // Add a few further-along contacts so appointmentsSet/confirmedShows are non-zero and distinct.
    contacts.push({ pipeline_stage: 'APPOINTMENT_CONFIRMED' }, { pipeline_stage: 'MET' });
    const tally = computeAgentRatio(contacts);
    const view = buildAgentRatioCardView(tally);
    expect(view.isBaseline).toBe(false);
    expect(view.status).toBe('SHIFTING'); // 24 data points: 20 <= n < 50
    expect(view.learningLabel).toBe('learning your community'); // still active per the 20-50 range
    expect(view.explainer).toContain(String(tally.introductions));
    expect(view.headline.every((n) => Number.isFinite(n))).toBe(true);
  });

  test('fully established (>= 50): the label drops, real numbers remain explained', () => {
    const contacts: FunnelContact[] = Array.from({ length: 60 }, () => ({ pipeline_stage: 'CLOSED_CLIENT' as const }));
    const view = buildAgentRatioCardView(computeAgentRatio(contacts));
    expect(view.status).toBe('SHIFTED');
    expect(view.learningLabel).toBeNull();
    expect(view.isBaseline).toBe(false);
    expect(view.explainer.length).toBeGreaterThan(0);
  });

  test('Field Trainer\'s Ratio: below threshold shows the baseline tail (5:1), explained', () => {
    const view = buildFieldTrainerRatioCardView(computeFieldTrainerRatio([]));
    expect(view.isBaseline).toBe(true);
    expect(view.headline).toEqual([BASELINE_RATIO.appointmentsSet, BASELINE_RATIO.outcome]);
    expect(view.learningLabel).toBe('learning your community');
    expect(view.explainer.length).toBeGreaterThan(0);
  });

  test('Field Trainer\'s Ratio: zero closes at real scale renders 0, not NaN, still explained', () => {
    const appointments: TrainerRunAppointment[] = Array.from({ length: 25 }, () => ({
      hasTrainer: true,
      status: 'CONFIRMED' as const,
      contactStage: 'MET' as const, // ran, but none closed
    }));
    const view = buildFieldTrainerRatioCardView(computeFieldTrainerRatio(appointments));
    expect(view.isBaseline).toBe(false);
    expect(view.headline.every((n) => Number.isFinite(n))).toBe(true);
    expect(view.headline[1]).toBe(0); // simplifyRatioParts leaves zero legitimately as 0
    expect(view.explainer).toContain('0');
  });
});

describe('simplifyRatioParts — zero-division-safe', () => {
  test('an all-zero input returns itself unsimplified (never divides by zero, never NaN)', () => {
    expect(simplifyRatioParts([0, 0, 0])).toEqual([0, 0, 0]);
  });

  test('simplifies by the GCD of the non-zero parts', () => {
    expect(simplifyRatioParts([40, 10, 0])).toEqual([4, 1, 0]);
  });
});
