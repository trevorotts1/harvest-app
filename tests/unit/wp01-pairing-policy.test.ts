// R-01 (refinements catalog 2026-07-28) — the role-keyed no-pairing policy for an RVP.
//
// Business rule (operator-confirmed): once someone reaches RVP they own their own organization —
// they are not paired with anyone, do not report up, and people report to THEM. An RVP is never
// REQUIRED to name an immediate upline (name or upline solution ID all optional/skippable), and an
// upline they MAY optionally name (their SVP/promoter, if on-platform) never "steps in" or
// supervises. Levels BELOW RVP keep the normal required upline pairing.
//
// This suite proves the policy module (the single role-keyed source of truth) and the two
// role-keyed consumers that must never drift from it: the flow model's rep-track screen list
// (flow-model.ts `repScreensForRole` — the sponsor/pairing screen is dropped for an RVP) and the
// track shell's sponsor-matching requirement (tracks.ts `trackRequiresSponsorMatching`).

import { Role } from '@prisma/client';

import { repScreensForRole } from '../../src/app/onboarding/flow-model';
import {
  pairingRequiredForRole,
  sponsorStepSkippedForRole,
} from '../../src/services/onboarding/wp01/pairing-policy';
import { trackRequiresSponsorMatching } from '../../src/services/onboarding/wp01/tracks';

describe('R-01 — RVP no-pairing policy (pairing-policy.ts)', () => {
  test('RVP pairing is NEVER required — an RVP is never required to name an immediate upline', () => {
    expect(pairingRequiredForRole(Role.RVP)).toBe(false);
  });

  test('levels BELOW RVP keep the normal REQUIRED pairing (REP/UPLINE/DUAL — unchanged)', () => {
    for (const role of [Role.REP, Role.UPLINE, Role.DUAL] as const) {
      expect(pairingRequiredForRole(role)).toBe(true);
    }
  });

  test('ADMIN (system role, minimal track) keeps required-pairing default — never silently optional', () => {
    expect(pairingRequiredForRole(Role.ADMIN)).toBe(true);
  });

  test('only RVP skips the sponsor/pairing STEP — the sponsor step is not offered to an RVP at all', () => {
    expect(sponsorStepSkippedForRole(Role.RVP)).toBe(true);
    for (const role of [Role.REP, Role.UPLINE, Role.DUAL, Role.ADMIN] as const) {
      expect(sponsorStepSkippedForRole(role)).toBe(false);
    }
  });
});

describe('R-01 — the rep-track screen list is role-keyed (flow-model.ts repScreensForRole)', () => {
  test('an RVP rep-track flow has NO sponsor screen — the pairing screen does not exist for them', () => {
    const screens = repScreensForRole(Role.RVP);
    expect(screens).not.toContain('sponsor');
    // The rest of the rep track is intact and in order (vision → identity → org → goals → whys →
    // contacts → reveal → consent → first48) — only the pairing surface is removed.
    expect(screens).toEqual([
      'vision',
      'identity',
      'org',
      'goals_intensity',
      'seven_whys',
      'contacts',
      'reveal',
      'consent',
      'first48',
    ]);
  });

  test('levels BELOW RVP (and ADMIN) keep the FULL rep-track screen list, sponsor included — unchanged', () => {
    const full = [
      'vision',
      'identity',
      'org',
      'goals_intensity',
      'seven_whys',
      'sponsor',
      'contacts',
      'reveal',
      'consent',
      'first48',
    ];
    for (const role of [Role.REP, Role.UPLINE, Role.DUAL, Role.ADMIN] as const) {
      expect([...repScreensForRole(role)]).toEqual(full);
    }
  });

  test('TEETH: an RVP flow progressing past seven_whys lands on contacts, never sponsor', () => {
    // A walking advance from seven_whys through the role-keyed list must skip the sponsor screen
    // entirely — this is the exact walk `OnboardingFlow.advance()` performs for an RVP.
    const screens = repScreensForRole(Role.RVP);
    const idx = screens.indexOf('seven_whys');
    expect(screens[idx + 1]).toBe('contacts');
    expect(screens).not.toContain('sponsor');
  });
});

describe('R-01 — the track shell agrees: RVP requires no sponsor/upline matching (tracks.ts)', () => {
  test('RVP is NOT required to complete a sponsor/upline-matching step (Flow D has none)', () => {
    expect(trackRequiresSponsorMatching(Role.RVP)).toBe(false);
  });

  test('REP/UPLINE/DUAL tracks still require the sponsor/upline step — unchanged', () => {
    expect(trackRequiresSponsorMatching(Role.REP)).toBe(true);
    expect(trackRequiresSponsorMatching(Role.UPLINE)).toBe(true);
    expect(trackRequiresSponsorMatching(Role.DUAL)).toBe(true);
  });

  test('ADMIN (minimal track, no sponsor step) is not sponsor-matching-required', () => {
    expect(trackRequiresSponsorMatching(Role.ADMIN)).toBe(false);
  });

  test('Flow D (the RVP track) has no sponsor/upline-PAIRING step in its shell — its org-sponsorship step is the RVP\'s own downline org, not an upline pairing', () => {
    const { stepsForRole } = require('../../src/services/onboarding/wp01/tracks');
    const rvpKeys = stepsForRole(Role.RVP).map((s: { key: string }) => s.key);
    // The two PAIRING step keys are absent for an RVP; the mandated Flow D step
    // `org_sponsorship_config` (the RVP's OWN downline-org sponsorship) legitimately remains.
    expect(rvpKeys).not.toContain('sponsor_matching');
    expect(rvpKeys).not.toContain('sponsor_upline_setup');
    expect(rvpKeys).toContain('org_sponsorship_config');
    // The regulatory spine is untouched — RVP still carries the licensure gate.
    expect(rvpKeys).toContain('finra_licensure');
  });
});
