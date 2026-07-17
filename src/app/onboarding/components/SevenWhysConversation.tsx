// uiux §5.1 O-5 — the Seven Whys conversation UI (Focus Shell chat).
//
// THE INVISIBLE-SCORE CONTRACT (§6.4, uiux AC-5.1-4): this component consumes ONLY the engine's
// `SevenWhysRenderedTurn` (seven-whys/types.ts), which structurally carries NO score/resonance
// field — so there is no data path by which a number-that-is-a-score could reach this render at all.
// A low resonance surfaces to the rep as `reprompt` — a caring re-ask with a pulsing seed — never as
// a failure and never as a number. This component renders one question per turn, a typing cadence
// before an agent turn, and the reflective acknowledgment; it emits no digits.

import type { SevenWhysRenderedTurn } from '@/services/onboarding/wp01/seven-whys';

import styles from '../onboarding.module.css';
import SevenSeedStepper from './SevenSeedStepper';

export interface SevenWhysConversationProps {
  turn: SevenWhysRenderedTurn;
  answer: string;
  onAnswerChange?: (value: string) => void;
  onSubmit?: () => void;
  /** Show the three-dot typing cadence before the agent's line (§5.1 O-5). */
  typing?: boolean;
}

export default function SevenWhysConversation({
  turn,
  answer,
  onAnswerChange,
  onSubmit,
  typing = false,
}: SevenWhysConversationProps) {
  return (
    <div className={styles.stepInner}>
      <SevenSeedStepper filledLevels={turn.filledLevels} pulsingLevel={turn.pulsingLevel} />

      <div className={styles.chat} aria-live="polite">
        {turn.acknowledgment ? <p className={styles.ack}>{turn.acknowledgment}</p> : null}

        {typing ? (
          <span className={styles.typing} aria-label="Your agent is thinking">
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

      {!turn.complete ? (
        <form
          className={styles.field}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit?.();
          }}
        >
          <label className={styles.label} htmlFor="seven-whys-answer">
            Your answer
          </label>
          <textarea
            id="seven-whys-answer"
            className={styles.input}
            rows={3}
            value={answer}
            onChange={(e) => onAnswerChange?.(e.target.value)}
            // A re-prompt is care, never a failure — no error styling, no error message.
            placeholder={turn.reprompt ? "Take your time — say a little more when you're ready." : 'Type here…'}
          />
          <div className={styles.actions}>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!answer.trim()}>
              Continue
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
