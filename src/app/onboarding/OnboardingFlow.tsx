'use client';

// WP01 §5.1 (uiux) — the O-1..O-9 onboarding orchestrator (T-20). Drives the pure `flow-model`
// step machine and renders each O-screen component, so the cinematic rep flow (Flow A) and the
// dense upline/RVP track (Flow B/D) are actually reachable and resume-exact. The screens consume
// the T-17/T-18/T-19 engines via their public types/pure functions; this shell owns only local UI
// state and step advancement (the server-side persistence/gate live in the API layer).
//
// R-09: the Seven Whys turns are NO LONGER produced locally from hard-coded literals — they now
// come from the real conversation API (`/api/onboarding/seven-whys`, driven by the engine +
// Agnes per T-R55b), and this shell owns only the fetch/advance wiring. The engine's rendered-turn
// shape (`SevenWhysRenderedTurn`) structurally cannot carry a score — so the invisible-resonance
// contract holds by construction, end to end.
//
// R-02: the org type is NOT selected in this flow anymore. It is captured exactly once at
// registration (`User.org_type`, fail-closed to EXTERNAL) and handed in from the SERVER session as
// the `orgType` prop — the same server-computed pattern R-01 uses for `role`. The O-3 org-context
// screen therefore never asks "Where do you build?" again and never surfaces the Primerica-vs-other
// framing; a non-Primerica user sees a clean, generic experience with zero Primerica strings (the
// org-gate at src/services/onboarding/wp01/org-gate.ts keeps enforcing that at the data layer).

import { IntensitySetting, OrgType, Role } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

import { useLocale } from '@/app/locale-context';
import StatusMessage from '@/components/StatusMessage';
import { errorDisplay } from '@/lib/i18n/error-display';
import {
  isNativeContactsPlatform,
  nativeClientPlatform,
  nativeContactSourceForPlatform,
  nativeContactsPlugin,
} from '@/lib/native/capacitor-contacts';
import { MAX_IMPORT_ROWS } from '@/services/warm-market/vault/csv-parser';
import type { NativeContactCandidate } from '@/services/warm-market/vault/native-contacts-adapter';
import { runNativeContactsDiscovery } from '@/services/warm-market/vault/native-import-flow';
import type { SevenWhysRenderedTurn } from '@/services/onboarding/wp01/seven-whys';
import { matchSponsor, type SponsorMatchOutcome, type SponsorCandidate } from '@/services/onboarding/wp01/sponsor-matching';
import { sponsorStepSkippedForRole } from '@/services/onboarding/wp01/pairing-policy';
import { fetchSponsorCandidates, postSponsorDecision } from './sponsor-decision-client';
import { checkSolutionNumberForOrg } from '@/services/onboarding/wp01/solution-number';
import { computeHiddenEarnings, type HiddenEarningsResult } from '@/services/warm-market/hidden-earnings';
import type { LicensingState } from '@/services/compliance/licensing';
import { OnboardingStep } from '@/types/onboarding';

import ContactImportStep, { type ImportBeat } from './components/ContactImportStep';
import First48Handoff from './components/First48Handoff';
import GdprConsentStep from './components/GdprConsentStep';
import HiddenEarningsReveal from './components/HiddenEarningsReveal';
import IdentityStep, { type PhotoCaptureState } from './components/IdentityStep';
import IntensityDial from './components/IntensityDial';
import OrgStep from './components/OrgStep';
import SevenWhysConversation from './components/SevenWhysConversation';
import SponsorStep from './components/SponsorStep';
import UplineTrack from './components/UplineTrack';
import VisionSplash from './components/VisionSplash';
import {
  nextScreen,
  repScreensForRole,
  trackKindForRole,
  type OnboardingScreen,
} from './flow-model';
import {
  buildDenseTrackStepPlan,
  buildGoalCardPayload,
  buildIntensityDataPayload,
  buildRoleOrgContextPayload,
  buildSevenWhysResponses,
  postOnboardingComplete,
  postOnboardingStep,
  sendOrderedSteps,
  stepToScreen,
  type SevenWhysAnswerPair,
  type ServerStepRef,
} from './onboarding-step-client';
import {
  getSevenWhysTurn,
  postSevenWhysAnswer,
  postSevenWhysStart,
} from './seven-whys-client';
import styles from './onboarding.module.css';

export interface OnboardingFlowProps {
  /** Where to start — resolved from the persisted step for a returning rep (resume-exact). */
  initialScreen?: OnboardingScreen;
  /** The rep's role; REP runs the cinematic flow, UPLINE/RVP/DUAL/ADMIN the dense track. */
  role?: Role;
  // R-02 — the persisted registration-time org determination (read from the SERVER session,
  // exactly like `role`), which drives the whole org-gated flow. There is NO org selector in
  // onboarding anymore; this is the single source the O-3 org-context screen and every org-gated
  // computation (sponsor pool scoping, hidden-earnings calibration) read from.
  orgType?: OrgType;
  /** Dense-track licensure state (upline/RVP), consumed by the T-13-backed `UplineTrack`. */
  licensingState?: LicensingState;
}

export default function OnboardingFlow({
  initialScreen = 'vision',
  role = Role.REP,
  orgType = OrgType.EXTERNAL,
  licensingState = 'LICENSED',
}: OnboardingFlowProps) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const [screen, setScreen] = useState<OnboardingScreen>(initialScreen);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [photoState, setPhotoState] = useState<PhotoCaptureState>('unset');
  // R-02 — org is NO LONGER locally selected state: the server-session `orgType` prop is the one
  // source (fail-closed default EXTERNAL/universal, exactly like the registration route). All
  // reads below (`sponsorOutcome` scoping, `hiddenEarnings` calibration, the O-3 screen, the
  // dense-track plan) consume that single prop.
  const [solutionNumber, setSolutionNumber] = useState('');
  const [solutionConfirmed, setSolutionConfirmed] = useState(false);
  const [intensity, setIntensity] = useState<IntensitySetting | null>(null);
  // R-09 — the Seven Whys conversation now runs through the real API. `whyTurn` is the current
  // rendered turn (opening question → one question per turn → caring re-prompt → completed anchor),
  // `whyAnswer` the in-flight draft, and `whyPairs` the accumulated (question, answer) pairs the
  // rep actually submitted — kept locally so the deferred `SEVEN_WHYS`/`GOAL_CARD`/`INTENSITY` step
  // chain (fired on this screen's completion, see the crux note in onboarding-step-client.ts) has
  // the real question+answer text to persist (the questions are the engine's own, captured from the
  // turn each answer responded to). `whyUnavailable` renders the honest engine-unavailable surface
  // (§0.3 graceful pause) — the server is the ONLY source of turns, so an unavailable engine is
  // shown, never silently replaced by a local script.
  const [whyTurn, setWhyTurn] = useState<SevenWhysRenderedTurn | null>(null);
  const [whyAnswer, setWhyAnswer] = useState('');
  const [whyPairs, setWhyPairs] = useState<SevenWhysAnswerPair[]>([]);
  const [whyUnavailable, setWhyUnavailable] = useState(false);
  const [whyStarting, setWhyStarting] = useState(false);
  const [whyResumeError, setWhyResumeError] = useState(false);
  // AC-5.1-5 (O-5 completion) — local UI state, defaults OFF; T-18's WhySession already defaults
  // use_in_outreach_consent=false and only its own setOutreachConsent may ever flip it, so this is
  // purely the UI surface (no live wiring here, exactly like intensity/solutionNumber above).
  const [outreachConsent, setOutreachConsent] = useState(false);
  const [importBeat, setImportBeat] = useState<ImportBeat>('value');
  const [contactCount, setContactCount] = useState(0);
  // T-R30 (parity GAP 1) — the REAL CSV import's in-flight/error state. `onUseCsv` used to just fake
  // `contactCount=24` with no file ever read (T-51); this now drives an actual file picker → the
  // real Vault ingestion route (see `handleCsvFileSelected` below).
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  // Minted once per import ATTEMPT and reused across retries of that same attempt (§18.5
  // idempotency) — cleared once the attempt actually completes so a later, separate file selection
  // mints a fresh key rather than silently reusing a stale one.
  const csvIdempotencyKeyRef = useRef<string | null>(null);
  // T-58 — the REAL "Import from Phone" state. `onRequestPermission` used to just do
  // `setContactCount(24)` with no OS permission ever asked and no device contact ever read (see
  // `handleRequestNativeContacts` below for the real permission-gated device read + selection list
  // this replaces it with).
  const [nativeCandidates, setNativeCandidates] = useState<NativeContactCandidate[]>([]);
  const [nativeSelectedIds, setNativeSelectedIds] = useState<Set<string>>(new Set());
  const [nativeImporting, setNativeImporting] = useState(false);
  const [nativeImportError, setNativeImportError] = useState<string | null>(null);
  const nativeIdempotencyKeyRef = useRef<string | null>(null);
  // T-21R (§6.10-10) — GDPR consent capture: an explicit affirmative act, defaults OFF. Granting
  // calls the session-authenticated `/api/onboarding/consent` route, which is what actually invokes
  // WP11's `ConsentManager` and sets `User.gdpr_consent = true` (this local state is only the UI's
  // controlled toggle value, the same pattern as every other field above).
  const [gdprConsented, setGdprConsented] = useState(false);
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  // T-R37 — the LAST KNOWN persisted `current_step` for this user's real `OnboardingSession` row.
  // Seeded from `GET /status` on mount (resume) and advanced after every successful `/step` call
  // (see `sendOrderedSteps`'s `ServerStepRef` contract) — a plain ref (not React state) since it
  // exists purely to make the step-sequencing calls resume-safe, never to drive a render.
  const serverStepRef = useRef<ServerStepRef>({ current: null });
  // Guards each screen's "meaningful advance" handler against a double-submit (no disabled-button
  // wiring on IdentityStep/OrgStep's own Continue affordance — this ref-level guard is enough since
  // a duplicate click while a request is in flight is simply ignored, not queued).
  const inFlightRef = useRef(false);

  const [identitySubmitting, setIdentitySubmitting] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [orgSubmitting, setOrgSubmitting] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [sevenWhysSubmitting, setSevenWhysSubmitting] = useState(false);
  const [sevenWhysError, setSevenWhysError] = useState<string | null>(null);
  const [completeSubmitting, setCompleteSubmitting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // T-R37 — the dense (upline/RVP/DUAL/ADMIN) track's tail: every track shares the SAME trailing
  // `CONSENT_CAPTURE` step (wp01 tracks.ts) and this app has exactly one compliant, tested GDPR
  // consent affordance (`GdprConsentStep`) and one First-48 handoff (`First48Handoff`) — reused here
  // rather than inventing a second consent surface for the dense track alone.
  const [denseScreen, setDenseScreen] = useState<'checklist' | 'consent' | 'first48'>('checklist');
  const [denseSubmitting, setDenseSubmitting] = useState(false);
  const [denseError, setDenseError] = useState<string | null>(null);

  // R-08 — the REAL candidate pool. The old hard-coded empty candidate array made every session
  // resolve 'waitlisted' and made the 'linked' branch unreachable; the pool now comes from the
  // server (`/api/onboarding/sponsor-decision`, resolved from actual same-org-type,
  // sponsor-eligible, never-RVP users with their sponsorship/linkage rows preferred — R-01's
  // pairing policy enforced server-side). `sponsorCandidates` is the resolved pool,
  // `sponsorPoolLoading`/`sponsorPoolError` its honest in-flight/failure state (a failed pool
  // fetch shows the sponsor screen with a retry, never a fabricated empty pool — the matcher only
  // resolves 'waitlisted' when the pool is GENUINELY empty, exactly as §6.5 intends).
  const [sponsorCandidates, setSponsorCandidates] = useState<SponsorCandidate[] | null>(null);
  // The server-resolved display names for the pool (kept out of the pure matcher's candidate
  // shape — `SponsorCandidate` deliberately carries no PII-ish name; see sponsor-matching.ts).
  const [sponsorCandidateNames, setSponsorCandidateNames] = useState<Record<string, string>>({});
  const [sponsorPoolLoading, setSponsorPoolLoading] = useState(false);
  const [sponsorPoolError, setSponsorPoolError] = useState(false);
  const [sponsorSubmitting, setSponsorSubmitting] = useState(false);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  // R-08 JUDGE FIX (Findings 1 & 2) — the retry machinery behind the sponsor pool. `sponsorRetryNonce`
  // is the effect dependency that makes the Retry button ACTUALLY re-fetch (the pre-fix button only
  // cleared `sponsorCandidates`/`sponsorPoolError` — neither is an effect dep, so React never re-ran
  // the pool fetch and the rep was stuck on a blank sponsor screen after "Try again"). `sponsorUnavailable`
  // is the honest 409 accept-race state: the server re-derives the matcher's pick from FRESH DB state
  // and can 409 an honest rep when a sponsorship lands between preview and click — the rep then sees
  // the honest "that sponsor changed" copy and a Retry path that re-fetches the pool (same mechanism),
  // instead of the stale preview with a generic error. Failure never advances (fail-closed preserved).
  const [sponsorUnavailable, setSponsorUnavailable] = useState(false);
  const [sponsorRetryNonce, setSponsorRetryNonce] = useState(0);

  // The §6.5 verdict, consumed straight from the matcher over the REAL pool. `null` until the pool
  // resolves — the UI renders loading/error states instead of fabricating a verdict. The matcher
  // resolves 'waitlisted' ONLY when the pool is genuinely empty (no same-org, sponsor-eligible,
  // non-RVP user exists) — the honest §6.5 condition, never the old hard-coded universal.
  const sponsorOutcome: SponsorMatchOutcome | null = useMemo(() => {
    if (sponsorCandidates === null) return null;
    return matchSponsor(
      { orgType: orgType ?? OrgType.EXTERNAL, candidates: sponsorCandidates },
      new Date()
    );
  }, [orgType, sponsorCandidates]);
  // R-08 — resolve the real pool once the rep reaches the sponsor screen (the pool is rep- and
  // org-scoped server-side, so the mount-time fetch is keyed to this session; a retry re-fetches).
  // `sponsorRetryNonce` is the JUDGE-FIXED retry trigger: bumping it (from the Retry button or the
  // 409 accept-race retry) re-runs this effect, which re-fetches the pool, clears the error, and
  // re-renders loading → outcome. The effect still refuses to clobber an already-resolved pool, so
  // only the failure path (and the honest 409 re-pick) ever re-fetches.
  useEffect(() => {
    if (screen !== 'sponsor' || sponsorStepSkippedForRole(role) || sponsorCandidates !== null) {
      return;
    }
    let cancelled = false;
    setSponsorPoolLoading(true);
    setSponsorPoolError(false);
    setSponsorUnavailable(false);
    (async () => {
      try {
        const result = await fetchSponsorCandidates();
        if (cancelled) return;
        if (result.ok) {
          setSponsorCandidates(result.candidates.map((c) => ({
            userId: c.userId,
            // R-02 — the pool is org-scoped by the single session-sourced org determination.
            orgType,
            // The server-resolved REAL load — the displayed verdict and the accept-time
            // re-derivation weigh the same numbers, so the matched sponsor is the persisted one.
            activeSponsorshipCount: c.activeSponsorshipCount,
          })));
          setSponsorCandidateNames(Object.fromEntries(result.candidates.map((c) => [c.userId, c.name])));
        } else {
          setSponsorPoolError(true);
        }
      } catch {
        if (!cancelled) setSponsorPoolError(true);
      } finally {
        if (!cancelled) setSponsorPoolLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, role, sponsorRetryNonce]);

  // R-08 — the four sponsor-outcome buttons now persist a REAL choice server-side
  // (`POST /api/onboarding/sponsor-decision`); only a confirmed success advances the rep. A failed
  // or rejected call surfaces honestly (never a silent advance): the server re-verifies `accept`'s
  // sponsor id against its own matcher's pick before persisting anything, so a tampered choice
  // fails closed with a 409 here.
  async function persistSponsorDecision(decision: 'accept' | 'join_waitlist' | 'start_paid' | 'no_upline_yet') {
    if (inFlightRef.current || sponsorSubmitting) return;
    inFlightRef.current = true;
    setSponsorSubmitting(true);
    setSponsorError(null);
    try {
      const sponsorId = decision === 'accept' && sponsorOutcome?.kind === 'linked' ? sponsorOutcome.sponsorId : null;
      const result = await postSponsorDecision(decision, sponsorId);
      if (!result.ok) {
        // JUDGE FIX (Finding 2) — the accept race, handled honestly: the server re-derives the
        // matcher's pick from FRESH state and 409s when a sponsorship landed between preview and
        // click (or the picked sponsor otherwise became unavailable). That is never a generic
        // error and never an advance — the rep sees the honest "that sponsor changed" copy and a
        // Retry that re-fetches the pool so they can re-pick. A genuine tamper/unknown id also
        // 409s and is served by the exact same re-pick surface (fail-closed either way).
        if (result.status === 409) {
          setSponsorUnavailable(true);
        } else {
          setSponsorError(errorDisplay(t, result.code));
        }
        return;
      }
      advance();
    } catch {
      setSponsorError(t('errors.generic'));
    } finally {
      inFlightRef.current = false;
      setSponsorSubmitting(false);
    }
  }

  // R-08 JUDGE FIX (Findings 1 & 2) — the ONE retry path for the sponsor pool, shared by the pool
  // error branch's "Try again" button and the 409 accept-race "Re-pick" button. It resets the
  // resolved pool + error + unavailable states and bumps `sponsorRetryNonce`, which re-runs the
  // pool-fetch effect above (a fresh fetch, fresh loading render, fresh outcome). This is the
  // mechanism that makes Retry ACTUALLY re-fetch — the pre-fix handler only cleared two non-dep
  // states and left the rep on a blank sponsor screen.
  function retrySponsorPool() {
    setSponsorCandidates(null);
    setSponsorPoolError(false);
    setSponsorUnavailable(false);
    setSponsorRetryNonce((n) => n + 1);
  }

  // T-24 (§7.3/§8.4) — the O-8 Reveal's figure, computed by the ONE Hidden Earnings engine rather
  // than inline arithmetic (the pre-T-24 code here computed `contactCount * 5200` etc., which was
  // neither the spec's universal formula nor org-gated for Primerica — both fixed by routing through
  // `computeHiddenEarnings`). `hasValidSolutionNumber` mirrors the same live format check the O-3
  // org-context screen renders (§6.3: alphanumeric, format-checked — relaxed from a
  // fixed-7-digit-only rule per T-R57/operator directive 2026-07-28) — the Primerica branch only
  // calibrates once a confirmed, format-valid number is on file; a Primerica user who hasn't entered
  // one yet still gets the universal formula (§8.4's own "replacing... when a valid solution number
  // is present").
  const hiddenEarnings: HiddenEarningsResult = useMemo(
    () =>
      computeHiddenEarnings({
        contactCount,
        orgType,
        hasValidSolutionNumber:
          solutionConfirmed && checkSolutionNumberForOrg(orgType, solutionNumber).formatValid,
      }),
    [contactCount, orgType, solutionConfirmed, solutionNumber]
  );

  // R-09 — Seven Whys engine wiring. The conversation's turns come from the real API
  // (`/api/onboarding/seven-whys`), driven by the engine + Agnes (T-R55b). The following
  // handlers own the fetch/advance wiring; the rendered-turn shape (no score field) keeps the
  // invisible-resonance contract (§6.4, uiux AC-5.1-4) by construction.
  //
  // `handleSevenWhysAnswer` is the ONLY place an answer advances the conversation — the server
  // decides the next question, the caring re-prompt (gate ≤ 70), or completion with the per-rep
  // anchor. A failed call never invents a turn and never advances the rep past the real engine.
  async function startSevenWhysConversation() {
    if (whyStarting || whyTurn) return;
    setWhyStarting(true);
    setWhyUnavailable(false);
    try {
      const result = await postSevenWhysStart();
      if (result.ok) {
        if (result.turn) {
          setWhyTurn(result.turn);
        } else {
          setWhyUnavailable(true);
        }
        return;
      }
      // Network/HTTP failure: surface the unavailable state honestly — the server is the ONLY
      // source of turns, never a silent local stand-in.
      setWhyUnavailable(true);
    } catch {
      setWhyUnavailable(true);
    } finally {
      setWhyStarting(false);
    }
  }

  // T-R37 — resume: GET /status on mount. For a rep already on the seven_whys screen, also resume
  // the real conversation so a returning rep replays the open turn (uiux §5.1 O-5 "resume" state)
  // instead of restarting from level one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/onboarding/status');
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { currentStep?: OnboardingStep; completed?: boolean };
        if (!body.currentStep || body.completed) return;
        serverStepRef.current.current = body.currentStep;
        if (trackKindForRole(role) === 'dense') {
          if (body.currentStep === OnboardingStep.CONSENT_CAPTURE) setDenseScreen('consent');
          else if (body.currentStep === OnboardingStep.COMPLETE) setDenseScreen('first48');
          return;
        }
        setScreen(stepToScreen(body.currentStep));
        if (stepToScreen(body.currentStep) === 'seven_whys') {
          // Resume the real conversation from its persisted state — no engine call for the replay.
          const turnResult = await getSevenWhysTurn();
          if (!cancelled && turnResult.ok) {
            if (turnResult.turn) {
              setWhyTurn(turnResult.turn);
            } else {
              // No persisted conversation yet — the start handler owns the opening turn.
              void startSevenWhysConversation();
            }
          } else if (!cancelled && !turnResult.ok) {
            setWhyResumeError(true);
          }
        }
      } catch {
        // No session yet, or unreachable — start fresh, exactly like before this fix.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R-01 (refinements catalog 2026-07-28) — an RVP is never auto-paired: the sponsor-matching
  // screen (the rep track's pairing surface) is skipped for an RVP via the role-keyed
  // `repScreensForRole` (flow-model.ts), so advancing past `seven_whys` walks over `sponsor`
  // (which does not exist for this role) and lands directly on `contacts` — no pairing step, no
  // pairing requirement. Every other role keeps the exact pre-existing progression (the rep
  // track's screens are `REP_SCREENS` unchanged). The walk stays fail-safe: it always lands on a
  // screen that exists for this role, and the terminal fallback still routes to Today.
  function advance() {
    const screens = repScreensForRole(role);
    let next = nextScreen(screen);
    while (next && !screens.includes(next)) {
      next = nextScreen(next);
    }
    if (next) setScreen(next);
    // T-R28 (uiux AC-2-1): land directly on Today/Mission Control, not the retired `/dashboard`
    // demo stub — this comment already said "lands on Today" before the route matched that.
    else router.push('/today');
  }

  // T-21R (§6.10-10) — the ONLY call site that actually grants GDPR consent: hits the live,
  // session-authenticated route, which calls WP11's `ConsentManager` and durably records the
  // versioned/timestamped `ComplianceConsent` row + `User.gdpr_consent = true`. Never advances past
  // this screen on a failed request — a rep who never actually consented never reaches `first48`
  // (and, independently, `/api/onboarding/complete` also refuses completion without a recorded
  // consent — this is not the only enforcement point).
  //
  // T-R37 — ALSO advances the real session's `current_step` past `CONSENT_CAPTURE` (every role's
  // `ROLE_STEP_MAP` trailing step, shared by both tracks — see `GdprConsentStep`'s reuse on the
  // dense track below). This is a SEPARATE call from `/api/onboarding/consent` above: that route
  // durably grants the real, versioned WP11 consent record `/complete`'s own gate reads; THIS call
  // only advances the step-progression cursor `/step`'s own route reads. Both must succeed before
  // this screen advances — a failure in EITHER surfaces honestly here, never a silent partial
  // success (the consent grant is not undone on a step-call failure, since it is safely re-postable
  // on retry — WP11's consent write, and this route's own CONSENT_CAPTURE branch, are both
  // idempotent-safe to resend).
  async function handleGrantGdprConsent() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setConsentSubmitting(true);
    setConsentError(null);
    try {
      const response = await fetch('/api/onboarding/consent', { method: 'POST' });
      if (!response.ok) {
        // T-57 RE-GATE B [af7789d3] Finding 1 — never render the raw English `body.error`; resolve
        // a locale-correct string from the `errors.*` catalog by the response's machine `code`
        // (falls back to `errors.generic` for the generic session/RBAC-gate failure, which sets no
        // `code` of its own — still real, translated Spanish, never English).
        const body = await response.json().catch(() => ({}) as { code?: string });
        setConsentError(errorDisplay(t, body.code));
        return;
      }
      const stepResult = await postOnboardingStep(OnboardingStep.CONSENT_CAPTURE, { gdpr_consent: true });
      if (!stepResult.ok) {
        setConsentError(errorDisplay(t, stepResult.code));
        return;
      }
      serverStepRef.current.current = stepResult.currentStep;
      if (trackKindForRole(role) === 'dense') setDenseScreen('first48');
      else advance();
    } catch {
      setConsentError(t('onboarding.gdprConsent.failedGeneric'));
    } finally {
      inFlightRef.current = false;
      setConsentSubmitting(false);
    }
  }

  // T-R37 — the final CTA (`First48Handoff.onShowToday`): completes onboarding for real
  // (`POST /api/onboarding/complete`, which fires `user.onboarding_completed` -> WP10 provisioning
  // and flips `User.onboarding_status` to `GATED_COMPLETE` — the exact column `withOnboardingGate`
  // requires) and ONLY THEN navigates to `/today`. A failed completion never navigates — the rep
  // would just bounce straight back off the gate — it surfaces honestly and lets the rep retry the
  // same idempotent-safe call (a session already past `INTENSITY`/`CONSENT_CAPTURE` is untouched by
  // a failed attempt; `completed` only flips to `true` in the same transaction as the WP10 publish).
  async function handleShowToday() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setCompleteSubmitting(true);
    setCompleteError(null);
    try {
      const result = await postOnboardingComplete();
      if (!result.ok) {
        setCompleteError(errorDisplay(t, result.code));
        return;
      }
      router.push('/today');
    } catch {
      setCompleteError(t('errors.generic'));
    } finally {
      inFlightRef.current = false;
      setCompleteSubmitting(false);
    }
  }

  // T-R37 — O-2 identity's "meaningful advance": the session's real `OnboardingSession` row does not
  // exist until the FIRST authenticated `/step` submission (`getOrCreateOnboardingSession`,
  // session-store.ts) — there is no separate `/api/onboarding/start` route. `REGISTER`/`ACCOUNT_TYPE`
  // carry no server-side format requirement (no `validateStep` branch reads either), so both are
  // sent with an (intentionally empty-but-truthy) `{}` payload — this screen's name/email/photo
  // fields are not persisted through `/step` (the `User` row's identity fields are already set at
  // registration, before this UI ever mounts; there is no route to revise them from here — a
  // separate, pre-existing gap this fix does not extend its scope to close).
  async function handleIdentityAdvance() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIdentitySubmitting(true);
    setIdentityError(null);
    try {
      const outcome = await sendOrderedSteps(role, serverStepRef.current, [
        { step: OnboardingStep.REGISTER, data: {} },
        { step: OnboardingStep.ACCOUNT_TYPE, data: {} },
      ]);
      if (!outcome.ok) {
        setIdentityError(errorDisplay(t, outcome.result.code));
        return;
      }
      advance();
    } finally {
      inFlightRef.current = false;
      setIdentitySubmitting(false);
    }
  }

  // T-R37 — O-3 org gate's "meaningful advance": submits `ROLE_ORG_CONTEXT`. `validateStep` only
  // format-checks a solution number when the user's REAL, already-persisted `org_type` is PRIMERICA
  // (read from the `User` row, not this submission) — sending it regardless (when present) keeps
  // this call correct for that case without needing to know the DB value client-side.
  //
  // R-02 — the submitted org is ALWAYS the server-session determination (the `orgType` prop, whose
  // own registration route resolved it fail-closed). A tampered/unknown org can never be declared
  // here: the payload is built from the session org, and the server independently re-checks against
  // the persisted `User.org_type` (validateStep) — fail-closed either way.
  async function handleOrgContinue() {
    if (inFlightRef.current) return;
    if (orgType === OrgType.PRIMERICA && solutionNumber && !solutionConfirmed) {
      setSolutionConfirmed(true);
    }
    inFlightRef.current = true;
    setOrgSubmitting(true);
    setOrgError(null);
    try {
      const result = await postOnboardingStep(
        OnboardingStep.ROLE_ORG_CONTEXT,
        buildRoleOrgContextPayload(orgType, solutionNumber)
      );
      if (!result.ok) {
        setOrgError(errorDisplay(t, result.code));
        return;
      }
      serverStepRef.current.current = result.currentStep;
      advance();
    } finally {
      inFlightRef.current = false;
      setOrgSubmitting(false);
    }
  }

  // R-09 — the conversation's per-turn submit. The engine (server-side, Agnes-driven) decides what
  // happens next: the next question, a caring re-prompt at the same level (invisible >70 resonance
  // gate, §6.4), or completion with the per-rep composed anchor. The rep's answer is recorded
  // locally BEFORE the call so the deferred step chain has real answer text to persist, and the
  // returned turn replaces the current one. A failed call keeps the previous turn on screen and
  // surfaces the unavailable state honestly — never a fabricated next question.
  async function handleSevenWhysAnswer() {
    const trimmed = whyAnswer.trim();
    if (!trimmed || inFlightRef.current) return;
    if (!whyTurn || whyTurn.complete) return;
    inFlightRef.current = true;
    setSevenWhysSubmitting(true);
    setWhyUnavailable(false);
    try {
      const result = await postSevenWhysAnswer(trimmed);
      if (result.ok) {
        if (result.turn) {
          // Record the pair the rep just answered: the engine's question they were responding to,
          // plus their answer — the exact Q&A the deferred step chain persists.
          setWhyPairs((prev) => [...prev, { question: whyTurn?.question ?? '', answer: trimmed }]);
          setWhyTurn(result.turn);
          setWhyAnswer('');
        } else {
          setWhyUnavailable(true);
        }
        return;
      }
      setWhyUnavailable(true);
    } catch {
      setWhyUnavailable(true);
    } finally {
      inFlightRef.current = false;
      setSevenWhysSubmitting(false);
    }
  }

  // T-R37 — O-5 Seven Whys completion's "meaningful advance": THE CRUX FIX. The UI screen order
  // (goals_intensity BEFORE seven_whys) does not match the server's real `ROLE_STEP_MAP` order
  // (`SEVEN_WHYS` must be submitted BEFORE `GOAL_CARD`/`INTENSITY`) — see onboarding-step-client.ts's
  // header comment. The O-4 dial's selection was captured locally (no network call at that screen);
  // all three steps fire together HERE, in the server-correct order, once the conversation completes.
  // R-09: the anchor statement is the REAL per-rep anchor composed by the engine (never a hard-coded
  // literal), and the step-chain payload is built from `whyPairs` — the actual (question, answer)
  // pairs the rep submitted through the conversation API, in the real conversation's order.
  async function handleSevenWhysContinue() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSevenWhysSubmitting(true);
    setSevenWhysError(null);
    try {
      const anchorStatement = whyTurn?.anchorStatement ?? '';
      const sevenWhysResponses = buildSevenWhysResponses(whyPairs);
      const goalCard = buildGoalCardPayload({
        anchorStatement,
        primaryGoal: whyPairs[0]?.answer ?? '',
        motivationStatement: whyPairs[1]?.answer ?? whyPairs[0]?.answer ?? '',
        intensity,
      });
      const intensityData = buildIntensityDataPayload(intensity ?? IntensitySetting.MEDIUM);
      const outcome = await sendOrderedSteps(role, serverStepRef.current, [
        { step: OnboardingStep.SEVEN_WHYS, data: { sevenWhys: sevenWhysResponses } },
        { step: OnboardingStep.GOAL_CARD, data: { goalCard } },
        { step: OnboardingStep.INTENSITY, data: { intensityData } },
      ]);
      if (!outcome.ok) {
        setSevenWhysError(errorDisplay(t, outcome.result.code));
        return;
      }
      advance();
    } finally {
      inFlightRef.current = false;
      setSevenWhysSubmitting(false);
    }
  }

  // T-R37 — the dense (upline/RVP/DUAL/ADMIN) track's "Finish setup": walks this role's REAL
  // `ROLE_STEP_MAP` (minus the trailing `CONSENT_CAPTURE`, submitted separately by the reused
  // `GdprConsentStep` tail below) via `buildDenseTrackStepPlan` — see that function's own doc
  // comment for the documented Primerica solution-number gap this dense UI cannot source data for.
  async function handleDenseFinish() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setDenseSubmitting(true);
    setDenseError(null);
    try {
      // R-02 — the dense track's ROLE_ORG_CONTEXT step is built from the session-sourced org.
      const plan = buildDenseTrackStepPlan(role, orgType, solutionNumber);
      const outcome = await sendOrderedSteps(role, serverStepRef.current, plan);
      if (!outcome.ok) {
        setDenseError(errorDisplay(t, outcome.result.code));
        return;
      }
      setDenseScreen('consent');
    } finally {
      inFlightRef.current = false;
      setDenseSubmitting(false);
    }
  }

  // T-R30 (parity GAP 1) — the O-7 "Import a CSV" real handler, extracted from the ORIGINAL file-
  // input `onChange` (below) so BOTH the file-input path AND the T-57 C5 drag-and-drop zone (the
  // desktop/pointer-capable "Full" parity affordance, uiux §6.3) share exactly one read+POST+
  // idempotency-key path — never a second, hand-copied import flow that could drift from the real
  // one. Reads the selected/dropped file as text and POSTs it to the REAL onboarding-time Vault
  // ingestion route (session-gated, NOT onboarding-complete-gated — see that route's own file header
  // for why it can't be `/api/contacts/import`). `contactCount` is set from the route's actual
  // `importedCount + mergedCount` — never a fake constant. A failed import never advances the screen
  // and never fabricates a count; the rep can retry or fall back to "Add one at a time".
  async function processCsvFile(file: File) {
    setCsvError(null);
    setCsvImporting(true);
    if (!csvIdempotencyKeyRef.current) {
      csvIdempotencyKeyRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `csv-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    try {
      const csvText = await file.text();
      const response = await fetch('/api/onboarding/contacts-import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csvText, idempotencyKey: csvIdempotencyKeyRef.current }),
      });
      const body = await response.json().catch(() => ({}) as { code?: string });
      if (!response.ok) {
        // T-57 RE-GATE B [af7789d3] Finding 1 — never render the raw English `body.error`; resolve
        // a locale-correct string from the `errors.*` catalog by the route's machine `code`.
        setCsvError(errorDisplay(t, body.code, { maxRows: MAX_IMPORT_ROWS }));
        return;
      }
      // This attempt is done — a later, separate file selection mints a fresh idempotency key.
      csvIdempotencyKeyRef.current = null;
      const result = body as { importedCount?: number; mergedCount?: number };
      setContactCount((result.importedCount ?? 0) + (result.mergedCount ?? 0));
      advance();
    } catch {
      setCsvError(t('onboarding.contactImport.denied.importFailedGeneric'));
    } finally {
      setCsvImporting(false);
    }
  }

  async function handleCsvFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same filename on a retry
    if (!file) return;
    await processCsvFile(file);
  }

  // T-58 — the real "Import from Phone" dedupe surface: the rep's already-imported Vault contacts'
  // normalized phone/email (never full PII — see the route's own doc comment), read BEFORE the
  // device contacts so `native-contacts-adapter.ts`'s dedupe can flag a candidate the rep already
  // has. A failed/unreachable fetch degrades to "no known existing contacts" (nothing is marked a
  // duplicate) rather than blocking the import attempt — dedupe is a UX nicety here; the SERVER'S own
  // merge-on-duplicate (VaultService.upsertRow) is the actual authority and never skipped.
  async function fetchExistingContactKeys(): Promise<{ phone: string | null; email: string | null }[]> {
    try {
      const response = await fetch('/api/onboarding/contacts-import');
      if (!response.ok) return [];
      const body = (await response.json()) as { contacts?: { phone: string | null; email: string | null }[] };
      return body.contacts ?? [];
    } catch {
      return [];
    }
  }

  // T-58 — the REAL "Connect my contacts" handler, replacing the old
  // `onRequestPermission={() => { setContactCount(24); advance(); }}` fake (no permission ever
  // asked, no device contact ever read). Three fail-closed branches, matching
  // `native-import-flow.ts`'s `NativeImportOutcome`:
  //   - not a native shell at all → 'unsupported' beat, the plugin is never even called (its own web
  //     fallback throws `unimplemented` for every method — this never gives it the chance to).
  //   - OS permission never resolves granted/limited → 'denied' beat, CSV/manual fallback offered,
  //     NO contact is read let alone created.
  //   - granted → the real device read, mapped + deduped, presented on the 'select' beat for the
  //     rep to choose from; nothing is imported until `handleConfirmNativeImport` fires.
  async function handleRequestNativeContacts() {
    setNativeImportError(null);
    const isNative = isNativeContactsPlatform();
    if (!isNative) {
      setImportBeat('unsupported');
      return;
    }

    setImportBeat('permission');
    const existing = await fetchExistingContactKeys();
    const outcome = await runNativeContactsDiscovery({
      isNativePlatform: isNative,
      plugin: nativeContactsPlugin,
      existing,
    });

    if (outcome.kind === 'unsupported') {
      setImportBeat('unsupported');
      return;
    }
    if (outcome.kind === 'denied') {
      setImportBeat('denied');
      return;
    }
    if (outcome.kind === 'error') {
      setNativeImportError(t('onboarding.contactImport.denied.nativeImportFailedGeneric'));
      setImportBeat('denied');
      return;
    }

    setNativeCandidates(outcome.candidates);
    // Pre-check every NON-duplicate candidate (the common case: a first-time import) — a flagged
    // duplicate is still shown (never hidden) but starts unchecked, since it's very likely already
    // in the rep's community; the rep can still check it (harmless — the server merges safely).
    setNativeSelectedIds(new Set(outcome.candidates.filter((c) => !c.isDuplicate).map((c) => c.contactId)));
    setImportBeat('select');
  }

  function handleToggleNativeCandidate(contactId: string) {
    setNativeSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  function handleSelectAllNative() {
    setNativeSelectedIds(new Set(nativeCandidates.map((c) => c.contactId)));
  }

  function handleDeselectAllNative() {
    setNativeSelectedIds(new Set());
  }

  function handleCancelNativeSelection() {
    setNativeCandidates([]);
    setNativeSelectedIds(new Set());
    setNativeImportError(null);
    setImportBeat('preview');
  }

  // T-58 — the rep's explicit "import these" confirmation. POSTs ONLY the checked candidates'
  // already-mapped rows to the real onboarding-time ingestion route (same Vault pipeline as CSV —
  // AES-256-GCM encryption, keyed-HMAC dedupe, minors gate). `contactCount` is set from the route's
  // actual `importedCount + mergedCount`, never a fake constant.
  async function handleConfirmNativeImport() {
    const selectedRows = nativeCandidates
      .filter((c) => nativeSelectedIds.has(c.contactId))
      .map((c) => c.row);
    if (selectedRows.length === 0) return;

    const clientPlatform = nativeClientPlatform();
    const source = nativeContactSourceForPlatform(clientPlatform);
    if (!source) {
      // Web can never reach a real 'select' beat (handleRequestNativeContacts routes it to
      // 'unsupported' first) — this is an unreachable-in-practice belt-and-suspenders check, never a
      // silent import under a forged/invalid source.
      setNativeImportError(t('onboarding.contactImport.denied.nativeImportFailedGeneric'));
      setImportBeat('unsupported');
      return;
    }

    setNativeImporting(true);
    setNativeImportError(null);
    if (!nativeIdempotencyKeyRef.current) {
      nativeIdempotencyKeyRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `native-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    try {
      const response = await fetch('/api/onboarding/contacts-import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source,
          contacts: selectedRows,
          clientPlatform,
          idempotencyKey: nativeIdempotencyKeyRef.current,
        }),
      });
      const body = await response.json().catch(() => ({}) as { code?: string });
      if (!response.ok) {
        setNativeImportError(errorDisplay(t, (body as { code?: string }).code, { maxRows: MAX_IMPORT_ROWS }));
        setImportBeat('denied');
        return;
      }
      // This attempt is done — a later, separate device read/selection mints a fresh idempotency key.
      nativeIdempotencyKeyRef.current = null;
      const result = body as { importedCount?: number; mergedCount?: number };
      setContactCount((result.importedCount ?? 0) + (result.mergedCount ?? 0));
      setNativeCandidates([]);
      setNativeSelectedIds(new Set());
      advance();
    } catch {
      setNativeImportError(t('onboarding.contactImport.denied.nativeImportFailedGeneric'));
      setImportBeat('denied');
    } finally {
      setNativeImporting(false);
    }
  }

  // T-57 C5 (uiux §6.3 "Full" desktop parity) — the drag-and-drop CSV drop zone. The affordance
  // itself is CSS-gated to pointer-capable/wide viewports (`.csvDropZone`'s `display: none` default,
  // lifted only under `(hover: hover) and (pointer: fine) and (min-width: 860px)` in
  // onboarding.module.css) — a touch-only/narrow viewport never sees the hint text, matching this
  // codebase's canonical ≥860 breakpoint (uiux §2.2) for "desktop-class" affordances. The handlers
  // below are harmless to attach unconditionally: a touch device simply never fires `dragover`/
  // `drop` events, so there is no functional difference, only a hidden hint on narrow viewports.
  const [csvDragActive, setCsvDragActive] = useState(false);

  function handleCsvDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setCsvDragActive(true);
  }

  function handleCsvDragLeave() {
    setCsvDragActive(false);
  }

  function handleCsvDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setCsvDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processCsvFile(file);
  }

  // Dense upline/RVP/DUAL/ADMIN track (Flow B/D): one shell, density not cinema — no vision splash,
  // no reveal. T-R37 — "Finish setup" now walks this role's real `/step` plan (`handleDenseFinish`)
  // before reaching the SAME shared consent + First-48 tail the rep track uses (every track's
  // `ROLE_STEP_MAP` ends in the identical `CONSENT_CAPTURE` step; see this module's own header note
  // for why a second consent surface was never built for this track). `onFinish` is only offered by
  // `UplineTrack` at all once `evaluateTrackCompletion` allows it (the §16.5 licensure hard-block).
  if (trackKindForRole(role) === 'dense') {
    if (denseScreen === 'consent') {
      return (
        <main className={styles.onboarding}>
          <GdprConsentStep
            consented={gdprConsented}
            onConsentedChange={setGdprConsented}
            onContinue={handleGrantGdprConsent}
            submitting={consentSubmitting}
            error={consentError}
          />
        </main>
      );
    }
    if (denseScreen === 'first48') {
      return (
        <main className={styles.onboarding}>
          <First48Handoff onShowToday={handleShowToday} submitting={completeSubmitting} error={completeError} />
        </main>
      );
    }
    return (
      <main className={styles.onboarding}>
        <UplineTrack role={role} licensingState={licensingState} onFinish={handleDenseFinish} />
        {denseSubmitting ? <StatusMessage tone="polite">{t('onboarding.uplineTrack.submittingStatus')}</StatusMessage> : null}
        {denseError ? <StatusMessage>{denseError}</StatusMessage> : null}
      </main>
    );
  }

  return (
    <main className={styles.onboarding}>
      {screen === 'vision' && <VisionSplash onBegin={advance} />}

      {screen === 'identity' && (
        <>
          <IdentityStep
            name={name}
            email={email}
            onNameChange={setName}
            onEmailChange={setEmail}
            photoState={photoState}
            onTakePhoto={() => setPhotoState('chosen')}
            onChooseFromLibrary={() => setPhotoState('chosen')}
            onSkipPhoto={() => {
              setPhotoState('skipped');
              void handleIdentityAdvance();
            }}
            onContinue={() => void handleIdentityAdvance()}
          />
          {identitySubmitting ? (
            <StatusMessage tone="polite">{t('onboarding.identity.submittingStatus')}</StatusMessage>
          ) : null}
          {identityError ? <StatusMessage>{identityError}</StatusMessage> : null}
        </>
      )}

      {/* R-02 — the O-3 org-context screen no longer asks "Where do you build?": the org is the
          persisted registration-time determination (the server-session `orgType` prop), so this
          screen only renders the branch-shaped context for that org — the Primerica solution-number
          capture, or the generic universal panel (zero Primerica strings). Never a second org
          choice; never the Primerica-vs-other framing. */}
      {screen === 'org' && (
        <OrgStep
          orgType={orgType}
          solutionNumber={solutionNumber}
          onSolutionNumberChange={setSolutionNumber}
          confirmed={solutionConfirmed}
        />
      )}
      {screen === 'org' && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={orgSubmitting}
            onClick={() => void handleOrgContinue()}
          >
            {t('onboarding.continueCta')}
          </button>
        </div>
      )}
      {screen === 'org' && orgError ? <StatusMessage>{orgError}</StatusMessage> : null}

      {screen === 'goals_intensity' && (
        <IntensityDial value={intensity} onChange={setIntensity} onContinue={advance} />
      )}

      {screen === 'seven_whys' && !whyTurn && !whyUnavailable && (
        <div className={styles.stepInner}>
          {whyStarting ? (
            <StatusMessage tone="polite">{t('onboarding.sevenWhys.agentThinkingAria')}</StatusMessage>
          ) : (
            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => void startSevenWhysConversation()}
              >
                {t('onboarding.continueCta')}
              </button>
            </div>
          )}
        </div>
      )}
      {screen === 'seven_whys' && whyUnavailable && (
        <div className={styles.stepInner}>
          <p className={styles.headline}>{t('onboarding.sevenWhys.unavailableTitle')}</p>
          <p>{t('onboarding.sevenWhys.unavailableBody')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void startSevenWhysConversation()}
            >
              {t('onboarding.sevenWhys.retryCta')}
            </button>
          </div>
        </div>
      )}
      {screen === 'seven_whys' && whyTurn && (
        <SevenWhysConversation
          turn={whyTurn}
          answer={whyAnswer}
          onAnswerChange={setWhyAnswer}
          onSubmit={() => void handleSevenWhysAnswer()}
          typing={sevenWhysSubmitting}
          outreachConsent={outreachConsent}
          onOutreachConsentChange={setOutreachConsent}
        />
      )}
      {screen === 'seven_whys' && whyTurn?.complete && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={sevenWhysSubmitting}
            onClick={() => void handleSevenWhysContinue()}
          >
            {t('onboarding.continueCta')}
          </button>
        </div>
      )}
      {screen === 'seven_whys' && sevenWhysError ? <StatusMessage>{sevenWhysError}</StatusMessage> : null}
      {screen === 'seven_whys' && whyResumeError ? (
        <StatusMessage>{t('onboarding.sevenWhys.unavailableBody')}</StatusMessage>
      ) : null}

      {screen === 'sponsor' && !sponsorStepSkippedForRole(role) && (
        <>
          {sponsorPoolLoading && (
            <div className={styles.stepInner}>
              <StatusMessage tone="polite">{t('onboarding.sponsor.loadingPool')}</StatusMessage>
            </div>
          )}
          {sponsorPoolError && (
            <div className={styles.stepInner}>
              {/* role="alert" — the guard's structural live-region contract (T-57 RG4): a status
                  render inside an error branch must be announced. The retry button below sits
                  outside the region (interactive control labels are not status messages). */}
              <div role="alert">
                <p className={styles.headline}>{t('onboarding.sponsor.poolErrorTitle')}</p>
                <p>{t('onboarding.sponsor.poolErrorBody')}</p>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={retrySponsorPool}
                >
                  {t('onboarding.sponsor.poolRetryCta')}
                </button>
              </div>
            </div>
          )}
          {!sponsorPoolLoading && !sponsorPoolError && sponsorUnavailable && (
            <div className={styles.stepInner}>
              {/* role="alert" — the same guard's structural live-region contract as the pool error
                  branch above: the honest 409 accept-race message is a status render inside an
                  error branch and must be announced; the re-pick button sits outside the region. */}
              <div role="alert">
                <p className={styles.headline}>{t('onboarding.sponsor.sponsorUnavailableTitle')}</p>
                <p>{t('onboarding.sponsor.sponsorUnavailableBody')}</p>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={retrySponsorPool}
                >
                  {t('onboarding.sponsor.sponsorUnavailableRetryCta')}
                </button>
              </div>
            </div>
          )}
          {!sponsorPoolLoading && !sponsorPoolError && !sponsorUnavailable && sponsorOutcome && (
            <>
              <SponsorStep
                outcome={sponsorOutcome}
                // R-08 — the linked sponsor's REAL display name (resolved server-side from the
                // candidate's `User.name`), instead of the localizer default for an unknown one.
                sponsorName={
                  sponsorOutcome.kind === 'linked'
                    ? sponsorCandidateNames[sponsorOutcome.sponsorId]
                    : undefined
                }
                onAccept={() => void persistSponsorDecision('accept')}
                onJoinWaitlist={() => void persistSponsorDecision('join_waitlist')}
                onStartPaid={() => void persistSponsorDecision('start_paid')}
                onNoUplineYet={() => void persistSponsorDecision('no_upline_yet')}
              />
              {sponsorSubmitting ? (
                <StatusMessage tone="polite">{t('onboarding.sponsor.submittingStatus')}</StatusMessage>
              ) : null}
              {sponsorError ? <StatusMessage>{sponsorError}</StatusMessage> : null}
            </>
          )}
        </>
      )}

      {/* R-01 — an RVP is never paired with anyone, and the no-pairing statement is the on-screen
          truth. This guard panel replaces SponsorStep entirely for an RVP (never stacks with it):
          a) in the normal flow the sponsor screen is skipped for an RVP (repScreensForRole), so
             this is the honest screen that WOULD have been the pairing surface; and b) if an RVP
             somehow lands here anyway (e.g. a stale resume step), they see the no-pairing statement
             instead of a pairing prompt, and can continue without naming anyone. */}
      {screen === 'sponsor' && sponsorStepSkippedForRole(role) && (
        <div className={styles.stepInner}>
          <h1 className={styles.headline}>{t('onboarding.sponsor.rvpNoPairingHeadline')}</h1>
          <p className={styles.lede}>{t('onboarding.sponsor.rvpNoPairingBody')}</p>
          <p className={styles.caption}>{t('onboarding.sponsor.rvpUplineOptional')}</p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={advance}>
              {t('onboarding.continueCta')}
            </button>
          </div>
        </div>
      )}

      {screen === 'contacts' && (
        <>
          <ContactImportStep
            beat={importBeat}
            onAdvance={() => (importBeat === 'value' ? setImportBeat('preview') : advance())}
            // T-58: the REAL permission-gated device-contacts flow — no more faked contactCount=24.
            // See handleRequestNativeContacts's own doc comment for the three fail-closed branches.
            onRequestPermission={handleRequestNativeContacts}
            onDeny={() => setImportBeat('denied')}
            // T-R30 (parity GAP 1): opens the REAL OS file picker — no more faked contactCount.
            // `handleCsvFileSelected` (the input's onChange, below) does the actual read+import.
            onUseCsv={() => csvInputRef.current?.click()}
            onAddManually={() => {
              setContactCount(1);
              advance();
            }}
            csvImporting={csvImporting}
            csvError={csvError}
            nativeCandidates={nativeCandidates}
            nativeSelectedIds={nativeSelectedIds}
            onToggleNativeCandidate={handleToggleNativeCandidate}
            onSelectAllNative={handleSelectAllNative}
            onDeselectAllNative={handleDeselectAllNative}
            onConfirmNativeImport={handleConfirmNativeImport}
            onCancelNativeSelection={handleCancelNativeSelection}
            nativeImporting={nativeImporting}
            nativeImportError={nativeImportError}
          />
          {/* T-57 C5 (uiux §6.3 "Full" desktop parity) — drag-and-drop CSV zone, additive alongside
              the "Import a CSV" button above (never a replacement — the button is the only CSV path
              on touch/narrow viewports, where this hint is CSS-hidden). Only meaningful once the CSV
              path is actually offered (the 'denied' beat, mirroring ContactImportStep's own gating
              of the "Import a CSV" button to that same beat). */}
          {importBeat === 'denied' && (
            <div
              className={styles.csvDropZone}
              data-drag-active={csvDragActive}
              onDragOver={handleCsvDragOver}
              onDragLeave={handleCsvDragLeave}
              onDrop={handleCsvDrop}
            >
              {t('onboarding.contactImport.denied.dragDropHint')}
            </div>
          )}
          {/* Visually hidden (not display:none, so the ref's programmatic .click() stays reliable
              cross-browser) — triggered ONLY by the "Import a CSV" button above via csvInputRef. */}
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label={t('onboarding.contactImport.csvFileInputAria')}
            className={styles.srOnly}
            onChange={handleCsvFileSelected}
          />
        </>
      )}

      {screen === 'reveal' && (
        <HiddenEarningsReveal
          contactCount={contactCount}
          monthlyValueUsd={hiddenEarnings.kind === 'figure' ? hiddenEarnings.estimatedMonthlyValueUsd : 0}
          estimatedAppointments={hiddenEarnings.kind === 'figure' ? hiddenEarnings.estimatedAppointments : 0}
          estimatedClients={hiddenEarnings.kind === 'figure' ? hiddenEarnings.estimatedClients : 0}
          onContinue={advance}
          onAddContacts={() => setScreen('contacts')}
          locale={locale}
        />
      )}

      {screen === 'consent' && (
        <GdprConsentStep
          consented={gdprConsented}
          onConsentedChange={setGdprConsented}
          onContinue={handleGrantGdprConsent}
          submitting={consentSubmitting}
          error={consentError}
        />
      )}

      {screen === 'first48' && (
        <First48Handoff onShowToday={handleShowToday} submitting={completeSubmitting} error={completeError} />
      )}
    </main>
  );
}
