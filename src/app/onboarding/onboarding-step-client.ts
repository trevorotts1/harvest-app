// T-R37 — wires the CLIENT onboarding flow (`OnboardingFlow.tsx`/`UplineTrack.tsx`) to the REAL,
// now-persisted (T-R36) `/api/onboarding/step` + `/api/onboarding/complete` routes.
//
// THE CRUX (read this before touching the screen→step wiring in OnboardingFlow.tsx): the UI's own
// screen order (flow-model.ts's `REP_SCREENS`, and the wp01 `tracks.ts` shell it mirrors) shows
// `goals_intensity` BEFORE `seven_whys` — but the SERVER's `ROLE_STEP_MAP` (types/onboarding.ts) and
// `OnboardingService.getNextStep` require `SEVEN_WHYS` to be submitted BEFORE `GOAL_CARD`/`INTENSITY`
// (proven empirically by the real end-to-end walk in tests/unit/onboarding-session-persistence.test.ts,
// which drives the REAL route handlers, not a re-implementation). Sending `INTENSITY` right after the
// `goals_intensity` screen (matching UI order) would 400 — the server is still expecting `SEVEN_WHYS`.
//
// The fix kept here: the `goals_intensity` screen's Intensity Dial selection is captured LOCALLY only
// (no network call at that point) — the actual `SEVEN_WHYS` → `GOAL_CARD` → `INTENSITY` step calls are
// all sent together, in that SERVER-correct order, once the `seven_whys` screen's conversation
// completes. The rep never sees this reordering; the UI screens still render in their designed order.
//
// This module is deliberately framework-free (no React import) so it can be unit-tested by stubbing
// `global.fetch` directly (mirroring `resolveFirstTouchDraftId`,
// src/app/community/components/resolve-first-touch-draft.ts, and its test
// tests/unit/composer-handoff-wiring.test.ts — this repo's established pattern for testing a
// fetch-calling client helper without a DOM/jsdom, which this repo's Jest config does not provide:
// `testEnvironment: 'node'`, no `@testing-library/react`).

import { IntensitySetting, OrgType, Role } from '@prisma/client';

import {
  MIN_COMMITMENT_SCORE,
  OnboardingStep,
  ROLE_STEP_MAP,
  type GoalCommitmentCard,
  type IntensityData,
  type SevenWhysResponse,
} from '@/types/onboarding';
// The real, deterministic (no Claude/LLM call, no network) per-answer resonance heuristic the LOCAL
// Seven Whys conversation client already uses (`local-conversation-client.ts`) — reused here so a
// persisted `SevenWhysResponse.score` is a genuine, reproducible computation over the rep's own
// answer text, never a fabricated/hardcoded number pretending to be a real assessment.
import { estimateDepthSignal } from '@/services/onboarding/wp01/seven-whys';
import type { OnboardingScreen } from './flow-model';

// ─── Network result shapes — every function below returns a discriminated result, never throws for
// an HTTP-level or network-level failure (fail-closed callers check `.ok`, never assume success). ───

export interface StepSuccess {
  ok: true;
  currentStep: OnboardingStep;
  completed: boolean;
}
export interface StepFailure {
  ok: false;
  /** HTTP status, or `null` if the request never reached the server (network exception). */
  status: number | null;
  /** The route's machine `code`, when it set one (most `/step`/`/complete` failures do not — see
   *  `errorDisplay`'s documented fallback-to-`errors.generic` behavior, which every call site here
   *  relies on rather than inventing a bespoke catalog key per failure). */
  code?: string;
}
export type StepCallResult = StepSuccess | StepFailure;

export interface CompleteSuccess {
  ok: true;
  completed: true;
  accessTier: string;
  commitmentScore: number;
}
export type CompleteCallResult = CompleteSuccess | StepFailure;

type FetchLike = typeof fetch;

async function parseJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** POST `/api/onboarding/step` — the one place this app submits a step advance. Never throws. */
export async function postOnboardingStep(
  step: OnboardingStep,
  data: Record<string, unknown>,
  fetchImpl: FetchLike = fetch
): Promise<StepCallResult> {
  try {
    const response = await fetchImpl('/api/onboarding/step', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step, data }),
    });
    const body = await parseJsonBody(response);
    if (!response.ok) {
      return { ok: false, status: response.status, code: body.code as string | undefined };
    }
    return {
      ok: true,
      currentStep: body.currentStep as OnboardingStep,
      completed: Boolean(body.completed),
    };
  } catch {
    return { ok: false, status: null };
  }
}

/** POST `/api/onboarding/complete` — the terminal call; success is the ONLY condition under which a
 *  caller may navigate to `/today` (the gate requires `onboarding_status === GATED_COMPLETE`, which
 *  this route alone sets). Never throws. */
export async function postOnboardingComplete(fetchImpl: FetchLike = fetch): Promise<CompleteCallResult> {
  try {
    const response = await fetchImpl('/api/onboarding/complete', { method: 'POST' });
    const body = await parseJsonBody(response);
    if (!response.ok) {
      return { ok: false, status: response.status, code: body.code as string | undefined };
    }
    return {
      ok: true,
      completed: true,
      accessTier: body.accessTier as string,
      commitmentScore: body.commitmentScore as number,
    };
  } catch {
    return { ok: false, status: null };
  }
}

// ─── Resume-safe ordered-step sequencing ──────────────────────────────────────────────────────────

/** This role's position of `step` in the REAL `ROLE_STEP_MAP` (the authoritative progression order
 *  `OnboardingService.getNextStep` itself walks) — `-1` if this role's map doesn't contain it at all
 *  (e.g. `SPONSOR_MATCHING`, which exists as an `OnboardingStep` enum member but is in NO role's map). */
export function stepIndexInRoleMap(role: Role, step: OnboardingStep): number {
  return (ROLE_STEP_MAP[role] ?? ROLE_STEP_MAP[Role.REP]).indexOf(step);
}

export interface StepPlanItem {
  step: OnboardingStep;
  data: Record<string, unknown>;
}

export interface OrderedStepsSuccess {
  ok: true;
}
export interface OrderedStepsFailure {
  ok: false;
  failedStep: OnboardingStep;
  result: StepFailure;
}
export type OrderedStepsOutcome = OrderedStepsSuccess | OrderedStepsFailure;

/**
 * A mutable pointer to the LAST KNOWN persisted `current_step` for this user's session — read/updated
 * in place so a caller (`OnboardingFlow.tsx`) can seed it from `GET /status` on mount (resume) and see
 * it advance as steps land, without this module depending on React state.
 */
export interface ServerStepRef {
  current: OnboardingStep | null;
}

/**
 * Sends an ORDERED batch of step submissions (e.g. the `SEVEN_WHYS` → `GOAL_CARD` → `INTENSITY`
 * chain the `seven_whys` screen's completion fires, or a dense-track role's whole pre-consent plan),
 * fail-closed: the first rejection stops the batch and is returned to the caller — nothing after a
 * failure is ever sent, and the caller must not advance the UI past this point.
 *
 * RESUME-SAFE: if `serverStepRef.current` is already AHEAD of a plan item (per `ROLE_STEP_MAP`
 * order — e.g. a page reload after `SEVEN_WHYS` already landed but before `INTENSITY` did), that item
 * is skipped rather than re-submitted (which the real route would 400 on: `/step` only accepts the
 * step matching its own persisted position for `STEP_ORDER`-listed steps, and a stale resend of an
 * ALREADY-PASSED step is never what the caller means). `serverStepRef` is updated after every success
 * so a retry of a partially-failed batch only re-sends what didn't land.
 */
export async function sendOrderedSteps(
  role: Role,
  serverStepRef: ServerStepRef,
  plan: readonly StepPlanItem[],
  postStep: (step: OnboardingStep, data: Record<string, unknown>) => Promise<StepCallResult> = postOnboardingStep
): Promise<OrderedStepsOutcome> {
  for (const item of plan) {
    const known = serverStepRef.current;
    if (known !== null) {
      const knownIdx = stepIndexInRoleMap(role, known);
      const itemIdx = stepIndexInRoleMap(role, item.step);
      if (knownIdx !== -1 && itemIdx !== -1 && itemIdx < knownIdx) {
        continue; // already cleared in a prior attempt — never re-sent
      }
    }
    const result = await postStep(item.step, item.data);
    if (!result.ok) {
      return { ok: false, failedStep: item.step, result };
    }
    serverStepRef.current = result.currentStep;
  }
  return { ok: true };
}

// ─── Payload builders — the exact shapes `OnboardingService.validateStep` / `/step`'s route reads ──
// (ground truth: tests/unit/onboarding-session-persistence.test.ts's real-route walk, and
// `src/services/onboarding/service.ts`'s own field reads).

/**
 * `ROLE_ORG_CONTEXT`'s payload. `validateStep` reads `data.solution_number` (snake_case, ONLY that
 * key — see service.ts) to format-check a Primerica submission; `orgType`/`org_type` are included too
 * for forward-compat/clarity, though this step does not itself write them to the `User` row (that
 * happens only via the legacy `REGISTER`-step branch in `/step`'s route, or at registration).
 */
export function buildRoleOrgContextPayload(orgType: OrgType, solutionNumber: string): Record<string, unknown> {
  const trimmed = solutionNumber.trim();
  return {
    orgType,
    org_type: orgType,
    ...(trimmed ? { solutionNumber: trimmed, solution_number: trimmed } : {}),
  };
}

/**
 * One Seven Whys Q&A pair captured by the O-5 screen (`OnboardingFlow.tsx`'s `whyPairs`): the
 * engine's question the rep was responding to (captured from the turn at submit time) plus the
 * rep's submitted answer. R-09: these pairs now come from the REAL conversation API — never
 * hard-coded literals.
 */
export interface SevenWhysAnswerPair {
  question: string;
  answer: string;
}

/**
 * Builds the `SEVEN_WHYS` step's `sevenWhys: SevenWhysResponse[]` payload. Each `score` is the REAL
 * `estimateDepthSignal` heuristic (0..1) scaled to the documented 0–100 range — the same
 * computation the local (non-Claude) conversation client already performs — never a
 * fabricated/hardcoded number. This persists a reproducible per-answer resonance signal alongside
 * the rep's answers; the authoritative LIVE gate remains the engine's invisible >70 resonance
 * (wp01/seven-whys/engine.ts), which the conversation API (`/api/onboarding/seven-whys`, R-09)
 * evaluates and stores on WhySession — this payload is the durable record the goal-card/step
 * chain carries, not the gate.
 */
export function buildSevenWhysResponses(pairs: readonly SevenWhysAnswerPair[]): SevenWhysResponse[] {
  return pairs.map(({ question, answer }) => ({
    question,
    answer,
    score: Math.round(estimateDepthSignal(answer) * 100),
  }));
}

/**
 * No `IntensitySetting` (LOW/MEDIUM/HIGH) → `commitmentScore` (1-10) mapping exists anywhere else in
 * this codebase (confirmed by search) — the Intensity Dial (`IntensityDial.tsx`) only ever captures
 * the three-position enum, never a numeric score, `weeklyHours`, or `supportNeeds`. This mapping is
 * this fix's own, deliberately conservative choice: every position clears `MIN_COMMITMENT_SCORE` (5)
 * on its own — choosing ANY explicit intensity (an intentional commitment act per AC-5.1-3, the dial
 * has no default) should never itself block onboarding completion — and stays monotonic with the
 * dial's own ordering (Low < Medium < High).
 */
export function commitmentScoreForIntensity(intensity: IntensitySetting): number {
  switch (intensity) {
    case IntensitySetting.LOW:
      return 6;
    case IntensitySetting.MEDIUM:
      return 8;
    case IntensitySetting.HIGH:
      return 10;
    default:
      return MIN_COMMITMENT_SCORE;
  }
}

/**
 * `weeklyHours` is likewise never captured by any current O-screen. An illustrative, documented
 * default per intensity level (not a rep-entered value) — a placeholder until a real weekly-hours
 * capture affordance exists, exactly like `commitmentScoreForIntensity` above.
 */
export function weeklyHoursForIntensity(intensity: IntensitySetting): number {
  switch (intensity) {
    case IntensitySetting.LOW:
      return 5;
    case IntensitySetting.MEDIUM:
      return 15;
    case IntensitySetting.HIGH:
      return 30;
    default:
      return 5;
  }
}

/** Builds the `INTENSITY` step's `intensityData` payload from the O-4 dial's local selection. */
export function buildIntensityDataPayload(intensity: IntensitySetting): IntensityData {
  return {
    commitmentScore: commitmentScoreForIntensity(intensity),
    weeklyHours: weeklyHoursForIntensity(intensity),
    riskTolerance: intensity,
    supportNeeds: [],
  };
}

/** 90 days from now, date-only ISO (`YYYY-MM-DD`) — `GoalCommitmentCard.targetDate`'s documented
 *  default horizon; no O-screen lets the rep pick their own target date yet. */
export function defaultGoalCardTargetDate(now: Date = new Date()): string {
  const target = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  return target.toISOString().slice(0, 10);
}

export interface GoalCardInputs {
  /** The O-5 completion's engine-produced anchor line (`whyTurn.anchorStatement`). */
  anchorStatement: string;
  /** The rep's own GOAL-level Seven Whys answer — the most honest source for `primaryGoal` (never a
   *  fabricated goal string). Falls back to the anchor statement if the answer is empty. */
  primaryGoal: string;
  /** The rep's own URGENCY-level answer ("why does this matter now") — the most honest source for
   *  `motivationStatement`. Falls back to the anchor statement if empty. */
  motivationStatement: string;
  /** The O-4 dial's selection, used to derive `commitmentLevel` consistently with the `INTENSITY`
   *  step's own `commitmentScore` (same underlying signal, same mapping). `null` before a selection
   *  is made — falls back to the conservative `MIN_COMMITMENT_SCORE` floor. */
  intensity: IntensitySetting | null;
  now?: Date;
}

/** Builds the `GOAL_CARD` step's payload. `/step`'s route applies NO format validation to this
 *  step's content (see service.ts — no `GOAL_CARD` branch in `validateStep`), so this shape is a
 *  best-effort, genuinely-sourced synthesis rather than a server-mandated format. */
export function buildGoalCardPayload(inputs: GoalCardInputs): GoalCommitmentCard {
  const { anchorStatement, primaryGoal, motivationStatement, intensity, now } = inputs;
  return {
    primaryGoal: primaryGoal.trim() || anchorStatement,
    targetDate: defaultGoalCardTargetDate(now),
    commitmentLevel: intensity ? commitmentScoreForIntensity(intensity) : MIN_COMMITMENT_SCORE,
    motivationStatement: motivationStatement.trim() || anchorStatement,
    anchorStatement,
  };
}

// ─── Dense-track (UPLINE/RVP/DUAL/ADMIN) step plan ────────────────────────────────────────────────
//
// `UplineTrack.tsx` renders ONE dense checklist + a single "Finish setup" CTA — it has no per-step
// data-collection forms at all (no Seven Whys conversation, no Intensity Dial, and — R-05 — no
// solution-number re-entry: the number is captured EXACTLY ONCE at registration, on every track).
// This function walks that role's REAL `ROLE_STEP_MAP` (minus the trailing `CONSENT_CAPTURE`, which
// the shared consent screen — reused across every track, see `OnboardingFlow.tsx` — submits
// separately) and builds the best HONEST payload available for each step given what the dense track
// UI actually collects: nothing, for every step but `ROLE_ORG_CONTEXT` (whose solution-number
// format gate the `/step` route's T-R38 fallback satisfies server-side by REUSING the already-
// persisted, encrypted `User.solution_number` — see `decryptSolutionNumberFromStorage`) and the
// DUAL-only rep-derived steps, which get a clearly-documented MINIMUM-clearing placeholder rather
// than a fabricated realistic-looking value.
//
// R-05 (capture-once, resolved): the OLD "KNOWN GAP" note is GONE — it documented that a PRIMERICA
// upline/RVP/dual user's `ROLE_ORG_CONTEXT` submission here used to legitimately 400 because the
// dense UI had no solution-number input to source one from. T-R38 already fixed that server-side
// (reuse the persisted value when the payload omits one), and R-05 removes the REP track's own
// re-entry field — so NO track re-asks for the solution number anywhere; the value captured at
// registration is the only one that exists, and `/step` reuses it for the gate.
export function buildDenseTrackStepPlan(
  role: Role,
  orgType: OrgType | null,
  solutionNumber: string
): StepPlanItem[] {
  const steps = (ROLE_STEP_MAP[role] ?? ROLE_STEP_MAP[Role.REP]).filter((s) => s !== OnboardingStep.CONSENT_CAPTURE);
  return steps.map((step) => {
    switch (step) {
      case OnboardingStep.ROLE_ORG_CONTEXT:
        // R-05 — `solutionNumber` is always '' in every live caller now (no local re-entry exists
        // anywhere in onboarding); the parameter is kept so the dense plan's payload builder stays
        // honest about what the UI collects (nothing) while the server's T-R38 reuse fallback
        // satisfies the format gate from the persisted registration-time value.
        return { step, data: orgType ? buildRoleOrgContextPayload(orgType, solutionNumber) : {} };
      case OnboardingStep.SEVEN_WHYS:
        return { step, data: { sevenWhys: [] as SevenWhysResponse[] } };
      case OnboardingStep.GOAL_CARD:
        return {
          step,
          data: {
            goalCard: buildGoalCardPayload({
              anchorStatement: '',
              primaryGoal: '',
              motivationStatement: '',
              intensity: null,
            }),
          },
        };
      case OnboardingStep.INTENSITY:
        // A deliberately CONSERVATIVE placeholder (the exact `MIN_COMMITMENT_SCORE` floor, never
        // `commitmentScoreForIntensity`'s MEDIUM/HIGH values, which represent a REP's own explicit
        // dial selection) — this dense-track path never collected a real one to begin with.
        return {
          step,
          data: {
            intensityData: {
              commitmentScore: MIN_COMMITMENT_SCORE,
              weeklyHours: 0,
              riskTolerance: IntensitySetting.MEDIUM,
              supportNeeds: [],
            } satisfies IntensityData,
          },
        };
      default:
        return { step, data: {} };
    }
  });
}

// ─── Screen → OnboardingStep mapping (documentation + test-facing table) ──────────────────────────
//
// The rep (cinematic) track's mapping from each O-screen's "meaningful advance" to the server step(s)
// it fires, in the exact order `/step` accepts them (REP's real `ROLE_STEP_MAP`). `null` means the
// screen fires no `/step` call at all (either it's UI-only — `vision`/`sponsor`/`contacts`/`reveal` —
// or, for `goals_intensity`, the call is DEFERRED to `seven_whys`'s completion — see the crux note at
// the top of this file).
export const REP_SCREEN_STEP_PLAN: Readonly<Record<OnboardingScreen, readonly OnboardingStep[] | null>> = {
  vision: null,
  identity: [OnboardingStep.REGISTER, OnboardingStep.ACCOUNT_TYPE],
  org: [OnboardingStep.ROLE_ORG_CONTEXT],
  goals_intensity: null,
  seven_whys: [OnboardingStep.SEVEN_WHYS, OnboardingStep.GOAL_CARD, OnboardingStep.INTENSITY],
  sponsor: null,
  contacts: null,
  reveal: null,
  consent: [OnboardingStep.CONSENT_CAPTURE],
  first48: null, // fires POST /api/onboarding/complete, not /step — see postOnboardingComplete
};

/** Resume support: maps a persisted server `OnboardingStep` back onto the O-screen a returning rep
 *  should land on. Steps with no dedicated O-screen of their own (`ACCOUNT_TYPE`, `GOAL_CARD`,
 *  `INTENSITY`) resolve to the earlier screen whose "meaningful advance" handler owns that step (or
 *  step-chain) — resuming there re-attempts the whole chain, which `sendOrderedSteps`'s
 *  `ServerStepRef` skip-logic makes safe (already-cleared steps in the chain are never re-sent). */
export function stepToScreen(step: OnboardingStep): OnboardingScreen {
  switch (step) {
    case OnboardingStep.REGISTER:
    case OnboardingStep.ACCOUNT_TYPE:
      return 'identity';
    case OnboardingStep.ROLE_ORG_CONTEXT:
      return 'org';
    case OnboardingStep.SEVEN_WHYS:
    case OnboardingStep.GOAL_CARD:
    case OnboardingStep.INTENSITY:
      return 'seven_whys';
    case OnboardingStep.CONSENT_CAPTURE:
      return 'consent';
    case OnboardingStep.COMPLETE:
      return 'first48';
    default:
      return 'identity';
  }
}
