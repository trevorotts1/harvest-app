// WP08 §13.2, uiux §4.13 — the override-income math sheet: always FTC-safe-harbor-framed, never a
// dollar/income figure.

import { buildOverrideMathSheet, potentialTeamSizeAtDepth } from '../../src/services/taprooting/override-math';
import { SAFE_HARBOR_DISCLAIMERS } from '../../src/types/compliance';
import { VISION_LEGS, VISION_DEPTH } from '../../src/services/taprooting/tree-builder';

describe('override-math (§13.2 safe-harbor framing)', () => {
  it('computes the 3^depth structure figure', () => {
    expect(potentialTeamSizeAtDepth(1)).toBe(VISION_LEGS);
    expect(potentialTeamSizeAtDepth(4)).toBe(Math.pow(VISION_LEGS, 4));
  });

  it('every sheet carries the exact WP11 income safe-harbor disclaimer — never a second, drifting copy', () => {
    const sheet = buildOverrideMathSheet(3);
    expect(sheet.safeHarborDisclaimer).toBe(SAFE_HARBOR_DISCLAIMERS.income);
  });

  it('never includes a dollar figure or a guaranteed-income phrase (§0.5)', () => {
    const sheet = buildOverrideMathSheet(4);
    const combined = `${sheet.narrative} ${sheet.safeHarborDisclaimer}`;
    expect(combined).not.toMatch(/\$\d/);
    expect(combined.toLowerCase()).not.toMatch(/guarantee(d)? income|you will earn/);
  });

  it('clamps depth to a sane [1, 10] range', () => {
    expect(buildOverrideMathSheet(0).depth).toBe(1);
    expect(buildOverrideMathSheet(999).depth).toBe(10);
  });

  // T-57 RG8 (i18n; server-i18n-leak) — `narrative` used to be hardcoded English composed with no
  // path to Spanish. `locale` is now an explicit (optional, EN-default) parameter.
  describe('T-57 RG8 — narrative i18n', () => {
    it('defaults to English (byte-identical to the pre-fix behavior) when locale is omitted', () => {
      const sheet = buildOverrideMathSheet(3);
      expect(sheet.narrative).toBe(
        `At depth 3, the ${VISION_LEGS}-wide × ${VISION_DEPTH}-deep multiplication model illustrates a potential ` +
          `structure of ${Math.pow(VISION_LEGS, 3)} team members — a structural illustration of the ` +
          `model, not a forecast or promise of any individual's results.`
      );
    });

    it('renders a genuinely distinct, real Spanish narrative when locale="es"', () => {
      const en = buildOverrideMathSheet(3, 'en');
      const es = buildOverrideMathSheet(3, 'es');
      expect(es.narrative).not.toBe(en.narrative);
      expect(es.narrative).toContain('A la profundidad 3');
      expect(es.narrative).toContain('miembros de equipo');
      expect(es.narrative.toLowerCase()).not.toMatch(/\bat depth\b/);
    });
  });
});
