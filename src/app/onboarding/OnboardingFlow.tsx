'use client';

// WP01 §5.1 (uiux) — the O-1..O-9 onboarding orchestrator (T-20). Drives the pure `flow-model`
// step machine and renders each O-screen component, so the cinematic rep flow (Flow A) and the
// dense upline/RVP track (Flow B/D) are actually reachable and resume-exact. The screens consume
// the T-17/T-18/T-19 engines via their public types/pure functions; this shell owns only local UI
// state and step advancement (the server-side persistence/gate live in the API layer). The Seven
// Whys turns are produced locally from the engine's `SevenWhysRenderedTurn` shape — which
// structurally cannot carry a score — so the invisible-resonance contract holds by construction.

import { IntensitySetting, OrgType, Role } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { SevenWhysLevel, type SevenWhysRenderedTurn } from '@/services/onboarding/wp01/seven-whys';
import { matchSponsor, type SponsorMatchOutcome } from '@/services/onboarding/wp01/sponsor-matching';
import type { LicensingState } from '@/services/compliance/licensing';

import ContactImportStep, { type ImportBeat } from './components/ContactImportStep';
import First48Handoff from './components/First48Handoff';
import HiddenEarningsReveal from './components/HiddenEarningsReveal';
import IdentityStep from './components/IdentityStep';
import IntensityDial from './components/IntensityDial';
import OrgStep from './components/OrgStep';
import SevenWhysConversation from './components/SevenWhysConversation';
import SponsorStep from './components/SponsorStep';
import UplineTrack from './components/UplineTrack';
import VisionSplash from './components/VisionSplash';
import {
  nextScreen,
  resumeScreen,
  trackKindForRole,
  type OnboardingScreen,
} from './flow-model';
import styles from './onboarding.module.css';

// One warm, digit-free prompt per Seven Whys level (§5.1 O-5). A low resonance never surfaces here
// as a number — the engine's rendered turn has no score field, and a re-prompt is a caring re-ask.
const SEVEN_WHYS_QUESTIONS: Record<SevenWhysLevel, string> = {
  [SevenWhysLevel.GOAL]: 'What do you want most from building this?',
  [SevenWhysLevel.URGENCY]: 'Why does that matter to you right now?',
  [SevenWhysLevel.HISTORY]: 'Have you tried to change this before?',
  [SevenWhysLevel.CHALLENGE]: "What's gotten in the way until now?",
  [SevenWhysLevel.FEAR]: 'What are you afraid happens if nothing changes?',
  [SevenWhysLevel.TRANSFORMATION]: "Who do you become once you've got this handled?",
  [SevenWhysLevel.COMMITMENT]: 'Are you ready to commit to the work it takes?',
};
const SEVEN_WHYS_ORDER: SevenWhysLevel[] = [
  SevenWhysLevel.GOAL,
  SevenWhysLevel.URGENCY,
  SevenWhysLevel.HISTORY,
  SevenWhysLevel.CHALLENGE,
  SevenWhysLevel.FEAR,
  SevenWhysLevel.TRANSFORMATION,
  SevenWhysLevel.COMMITMENT,
];

export interface OnboardingFlowProps {
  /** Where to start — resolved from the persisted step for a returning rep (resume-exact). */
  initialScreen?: OnboardingScreen;
  /** The rep's role; REP runs the cinematic flow, UPLINE/RVP/DUAL/ADMIN the dense track. */
  role?: Role;
  /** Dense-track licensure state (upline/RVP), consumed by the T-13-backed `UplineTrack`. */
  licensingState?: LicensingState;
}

export default function OnboardingFlow({
  initialScreen = 'vision',
  role = Role.REP,
  licensingState = 'LICENSED',
}: OnboardingFlowProps) {
  const router = useRouter();
  const [screen, setScreen] = useState<OnboardingScreen>(initialScreen);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const [solutionNumber, setSolutionNumber] = useState('');
  const [solutionConfirmed, setSolutionConfirmed] = useState(false);
  const [intensity, setIntensity] = useState<IntensitySetting | null>(null);
  const [whyIndex, setWhyIndex] = useState(0);
  const [whyAnswer, setWhyAnswer] = useState('');
  const [importBeat, setImportBeat] = useState<ImportBeat>('value');
  const [contactCount, setContactCount] = useState(0);

  // Sponsor outcome consumed straight from the §6.5 matcher — with no candidate pool the rep is
  // waitlisted (never a dead end); the UI renders that verdict, it does not decide it.
  const sponsorOutcome: SponsorMatchOutcome = useMemo(
    () => matchSponsor({ orgType: orgType ?? OrgType.EXTERNAL, candidates: [] }),
    [orgType]
  );

  // The current Seven Whys turn, built from the engine's rendered-turn shape (no score field).
  const whyTurn: SevenWhysRenderedTurn = useMemo(() => {
    const complete = whyIndex >= SEVEN_WHYS_ORDER.length;
    return {
      filledLevels: SEVEN_WHYS_ORDER.slice(0, whyIndex),
      pulsingLevel: null,
      question: complete ? null : SEVEN_WHYS_QUESTIONS[SEVEN_WHYS_ORDER[whyIndex]],
      acknowledgment: whyIndex > 0 && !complete ? 'Thank you for sharing that.' : null,
      reprompt: false,
      complete,
      anchorStatement: complete ? 'You build so the people you love never have to worry.' : null,
    };
  }, [whyIndex]);

  function advance() {
    const next = nextScreen(screen);
    if (next) setScreen(next);
    else router.push('/dashboard'); // O-9 handoff lands on Today/Mission Control
  }

  // Dense upline/RVP track (Flow B/D): one shell, density not cinema — no vision splash, no reveal.
  if (trackKindForRole(role) === 'dense') {
    return (
      <main className={styles.onboarding}>
        <UplineTrack role={role} licensingState={licensingState} onFinish={() => router.push('/dashboard')} />
      </main>
    );
  }

  return (
    <main className={styles.onboarding}>
      {screen === 'vision' && <VisionSplash onBegin={advance} />}

      {screen === 'identity' && (
        <IdentityStep
          name={name}
          email={email}
          onNameChange={setName}
          onEmailChange={setEmail}
          onSkipPhoto={advance}
          onContinue={advance}
        />
      )}

      {screen === 'org' && (
        <OrgStep
          selectedOrgType={orgType}
          onSelectOrgType={(o) => {
            setOrgType(o);
            setSolutionConfirmed(false);
          }}
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
            disabled={!orgType}
            onClick={() => {
              if (orgType === OrgType.PRIMERICA && solutionNumber && !solutionConfirmed) {
                setSolutionConfirmed(true);
              }
              advance();
            }}
          >
            Continue
          </button>
        </div>
      )}

      {screen === 'goals_intensity' && (
        <IntensityDial value={intensity} onChange={setIntensity} onContinue={advance} />
      )}

      {screen === 'seven_whys' && (
        <SevenWhysConversation
          turn={whyTurn}
          answer={whyAnswer}
          onAnswerChange={setWhyAnswer}
          onSubmit={() => {
            setWhyAnswer('');
            setWhyIndex((i) => i + 1);
          }}
        />
      )}
      {screen === 'seven_whys' && whyTurn.complete && (
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={advance}>
            Continue
          </button>
        </div>
      )}

      {screen === 'sponsor' && (
        <SponsorStep
          outcome={sponsorOutcome}
          sponsorName="Your sponsor"
          onAccept={advance}
          onJoinWaitlist={advance}
          onStartPaid={advance}
          onNoUplineYet={advance}
        />
      )}

      {screen === 'contacts' && (
        <ContactImportStep
          beat={importBeat}
          onAdvance={() => (importBeat === 'value' ? setImportBeat('preview') : advance())}
          onRequestPermission={() => {
            setContactCount(24);
            advance();
          }}
          onDeny={() => setImportBeat('denied')}
          onUseCsv={() => {
            setContactCount(24);
            advance();
          }}
          onAddManually={() => {
            setContactCount(1);
            advance();
          }}
        />
      )}

      {screen === 'reveal' && (
        <HiddenEarningsReveal
          contactCount={contactCount}
          monthlyValueUsd={contactCount * 5200}
          estimatedAppointments={Math.round(contactCount * 0.35)}
          estimatedClients={Math.round(contactCount * 0.12)}
          onContinue={advance}
          onAddContacts={() => setScreen('contacts')}
        />
      )}

      {screen === 'first48' && <First48Handoff onShowToday={() => router.push('/dashboard')} />}
    </main>
  );
}
