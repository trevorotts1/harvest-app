// WP08 §13.2, uiux §4.13 — the override-income math sheet: always FTC-safe-harbor-framed, never a
// dollar/income figure.

import { buildOverrideMathSheet, potentialTeamSizeAtDepth } from '../../src/services/taprooting/override-math';
import { SAFE_HARBOR_DISCLAIMERS } from '../../src/types/compliance';
import { VISION_LEGS } from '../../src/services/taprooting/tree-builder';

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
});
