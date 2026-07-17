// WP01 §5.1 (uiux) — the onboarding entry page. Renders the O-1..O-9 orchestrator (Flow A cinematic
// rep track; the dense upline/RVP track for non-rep roles), replacing the pre-T-20 five-step demo
// scaffold. A fresh rep starts at the vision splash; the parallel `/onboarding/resume` route
// (the §6.10-1 gate's redirect target) starts a returning rep on their persisted step.

import OnboardingFlow from './OnboardingFlow';

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
