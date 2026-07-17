// WP01 §5.1 (uiux) — the onboarding flow model: the pure step machine the O-1..O-9 UI drives.
//
// Kept pure (no React, no DOM) so the resume-exact behavior (uiux AC-5.1-11 "every step resumes
// exactly after interruption; the resume prompt offers Resume from step X / Start over") is a
// property a test can assert directly, and so the cinematic rep track (Flow A) and the dense
// upline/RVP tracks (Flow B/D) share one ordering source. The wp01 `tracks.ts` state-machine SHELL
// (`stepsForRole`) is the authoritative track spine; this model maps that spine's step KEYS onto the
// finer-grained O-screens the UI actually renders (the reveal/first-48/contact-import screens are
// UI sub-steps the coarse track shell does not enumerate).

import { Role } from '@prisma/client';

import { stepsForRole, trackForRole, type OnboardingTrack } from '@/services/onboarding/wp01/tracks';

/** The nine rep-track screens (uiux §5.1 O-1..O-9), in order. */
export type OnboardingScreen =
  | 'vision' // O-1
  | 'identity' // O-2
  | 'org' // O-3
  | 'goals_intensity' // O-4
  | 'seven_whys' // O-5
  | 'sponsor' // O-6
  | 'contacts' // O-7
  | 'reveal' // O-8
  | 'first48'; // O-9

export const REP_SCREENS: readonly OnboardingScreen[] = [
  'vision',
  'identity',
  'org',
  'goals_intensity',
  'seven_whys',
  'sponsor',
  'contacts',
  'reveal',
  'first48',
];

/** The O-screen label (uiux §5.1) used by the resume prompt ("Resume from {label}?"). */
export const SCREEN_LABELS: Record<OnboardingScreen, string> = {
  vision: 'The opening',
  identity: 'Your details',
  org: 'Where you build',
  goals_intensity: 'Goals & intensity',
  seven_whys: 'Your why',
  sponsor: 'Your sponsor',
  contacts: 'Your community',
  reveal: "Your field's potential",
  first48: 'Your first 48',
};

/**
 * Map a persisted step identifier — either an O-screen id (this model's own) OR a wp01 Flow-A track
 * step KEY (tracks.ts) — onto the O-screen to resume on. This is the crux of resume-exact behavior:
 * whatever the server last persisted as the incomplete step, a returning rep lands on exactly that
 * screen. Unknown/empty resolves to the first screen (fail-safe: never a blank/undefined landing).
 */
const TRACK_KEY_TO_SCREEN: Record<string, OnboardingScreen> = {
  // wp01 Flow A step keys → O-screens
  vision_splash: 'vision',
  identity_capture: 'identity',
  role_org_context: 'org',
  goals_intensity: 'goals_intensity',
  seven_whys: 'seven_whys',
  sponsor_matching: 'sponsor',
};

export function resumeScreen(lastIncompleteStep: string | null | undefined): OnboardingScreen {
  if (!lastIncompleteStep) return REP_SCREENS[0];
  if ((REP_SCREENS as readonly string[]).includes(lastIncompleteStep)) {
    return lastIncompleteStep as OnboardingScreen;
  }
  return TRACK_KEY_TO_SCREEN[lastIncompleteStep] ?? REP_SCREENS[0];
}

export function screenIndex(screen: OnboardingScreen): number {
  return REP_SCREENS.indexOf(screen);
}

export function nextScreen(screen: OnboardingScreen): OnboardingScreen | null {
  const i = screenIndex(screen);
  return i >= 0 && i < REP_SCREENS.length - 1 ? REP_SCREENS[i + 1] : null;
}

export function prevScreen(screen: OnboardingScreen): OnboardingScreen | null {
  const i = screenIndex(screen);
  return i > 0 ? REP_SCREENS[i - 1] : null;
}

// ─── Track selection (rep = cinematic Flow A; upline/RVP/dual = dense) ───────────────────────────

export type TrackKind = 'rep' | 'dense';

/**
 * Which UI track a role runs. REP → the cinematic O-1..O-9 rep flow (Flow A). UPLINE/RVP/DUAL →
 * the dense track (Flow B/D shell; uiux §5.1 "reuse the same shell with density, not cinema: no
 * vision splash, no reveal"). ADMIN → dense/minimal.
 */
export function trackKindForRole(role: Role): TrackKind {
  return role === Role.REP ? 'rep' : 'dense';
}

/** The ordered dense-track step keys for a role (straight from the authoritative wp01 track shell). */
export function denseTrackSteps(role: Role): readonly string[] {
  return stepsForRole(role).map((s) => s.key);
}

export function wp01Track(role: Role): OnboardingTrack {
  return trackForRole(role);
}
