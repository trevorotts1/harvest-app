// uiux §5.1 O-5 — the Seven Whys conversation UI (Focus Shell chat).
//
// THE INVISIBLE-SCORE CONTRACT (§6.4, uiux AC-5.1-4): this component consumes ONLY the engine's
// `SevenWhysRenderedTurn` (seven-whys/types.ts), which structurally carries NO score/resonance
// field — so there is no data path by which a number-that-is-a-score could reach this render at all.
// A low resonance surfaces to the rep as `reprompt` — a caring re-ask with a pulsing seed — never as
// a failure and never as a number. This component renders one question per turn, a typing cadence
// before an agent turn, and the reflective acknowledgment; it emits no digits.
//
// AC-5.1-5 (T-20): once the conversation completes (the anchor-statement render below), the
// outreach-consent toggle renders in the same completion beat — `outreachConsent` is optional and
// only rendered when the caller supplies it, so callers that don't pass it (including the existing
// invisible-score tests) see no behavior change.

import type { SevenWhysRenderedTurn } from '@/services/onboarding/wp01/seven-whys';

import styles from '../onboarding.module.css';
import OutreachConsentToggle from './OutreachConsentToggle';
import SevenSeedStepper from './SevenSeedStepper';
import { useT } from '@/app/locale-context';

export interface SevenWhysConversationProps {
  turn: SevenWhysRenderedTurn;
  answer: string;
  onAnswerChange?: (value: string) => void;
  onSubmit?: () => void;
  /** Show the three-dot typing cadence before the agent's line (§5.1 O-5). */
  typing?: boolean;
  /** AC-5.1-5 outreach-consent toggle value, owned by the onboarding orchestrator (local useState,
   *  same pattern as intensity/solutionNumber; defaults false there). Rendered only once the turn
   *  completes, and only when a value is actually supplied. */
  outreachConsent?: boolean;
  onOutreachConsentChange?: (value: boolean) => void;
}

export default function SevenWhysConversation({
  turn,
  answer,
  onAnswerChange,
  onSubmit,
  typing = false,
  outreachConsent,
  onOutreachConsentChange,
}: SevenWhysConversationProps) {
  const t = useT();
  return (
    <div className={styles.stepInner}>
      <SevenSeedStepper filledLevels={turn.filledLevels} pulsingLevel={turn.pulsingLevel} />

      <div className={styles.chat} aria-live="polite">
        {turn.acknowledgment ? <p className={styles.ack}>{turn.acknowledgment}</p> : null}

        {typing ? (
          <span className={styles.typing} aria-label={t('onboarding.sevenWhys.agentThinkingAria')}>
            <span className={styles.typingDot} />
            <span className={styles.typingDot} />
            <span className={styles.typingDot} />
          </span>
        ) : null}

        {turn.complete ? (
          <div className={styles.bubbleAgent}>
            <p className={styles.headline}>{turn.anchorStatement}</p>
          </div>
        ) : (
          <div className={styles.bubbleAgent}>
            <p>{turn.question}</p>
          </div>
        )}
      </div>

      {turn.complete && typeof outreachConsent === 'boolean' ? (
        <OutreachConsentToggle value={outreachConsent} onChange={onOutreachConsentChange} />
      ) : null}

      {!turn.complete ? (
        <form
          className={styles.field}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit?.();
          }}
        >
          <label className={styles.label} htmlFor="seven-whys-answer">
            {t('onboarding.sevenWhys.answerLabel')}
          </label>
          <textarea
            id="seven-whys-answer"
            className={styles.input}
            rows={3}
            value={answer}
            onChange={(e) => onAnswerChange?.(e.target.value)}
            // A re-prompt is care, never a failure — no error styling, no error message.
            placeholder={turn.reprompt ? t('onboarding.sevenWhys.repromptPlaceholder') : t('onboarding.sevenWhys.typePlaceholder')}
          />
          <div className={styles.actions}>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!answer.trim()}>
              {t('onboarding.continueCta')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
