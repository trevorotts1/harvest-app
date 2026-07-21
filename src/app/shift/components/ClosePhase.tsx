// uiux §5.3 — Close (one screen): recap ("You approved N introductions; your agents take it from
// here"), streak increment (Grove leaf animation — handled by ShiftView/DoneScreen), an OPTIONAL
// one-line reflection with an EQUAL-WEIGHT skip (AC-5.3-5), then the explicit end state. This
// component renders the recap + reflection step; ShiftView swaps to DoneScreen once the rep
// finishes or skips (both call the same onFinish — same weight, same effect on progression).
//
// The timer's early-finish celebration lives here too (AC-5.3-2's "celebrates finishing early") —
// note it NEVER renders anything for the overtime case; there is no "you're over" branch at all.

import { useState } from 'react';

import styles from '../shift.module.css';
import { formatElapsed } from './WorkPhase';
import { useT } from '@/app/locale-context';
import type { TVars } from '@/lib/i18n/catalog';

export interface ClosePhaseProps {
  recap: { approvals: number; confirmations: number; logs: number } | null;
  elapsedSeconds: number;
  targetSeconds: number;
  onFinish: (reflectionText: string | undefined) => void;
}

// T-52 (WCAG 2.2 AA §17.4 / uiux §6.1 item 5): exported so DoneScreen.tsx can build the exact
// "Shift close" narration script ("You're done for today. {recap line}. Your agents take it from
// here.") from the SAME recap-composition logic this screen already uses, rather than a second,
// driftable copy of it.
export function recapLine(recap: ClosePhaseProps['recap'], t: (key: string, vars?: TVars) => string): string {
  if (!recap) return t('shift.closePhase.recap.nothingNeeded');
  const parts: string[] = [];
  if (recap.approvals > 0) {
    parts.push(t(recap.approvals === 1 ? 'shift.closePhase.recap.approvedOne' : 'shift.closePhase.recap.approvedMany', { count: recap.approvals }));
  }
  if (recap.confirmations > 0) {
    parts.push(t(recap.confirmations === 1 ? 'shift.closePhase.recap.confirmedOne' : 'shift.closePhase.recap.confirmedMany', { count: recap.confirmations }));
  }
  if (recap.logs > 0) {
    parts.push(t(recap.logs === 1 ? 'shift.closePhase.recap.loggedOne' : 'shift.closePhase.recap.loggedMany', { count: recap.logs }));
  }
  if (parts.length === 0) return t('shift.closePhase.recap.nothingNeeded');
  return t('shift.closePhase.recap.wrapper', { parts: parts.join('; ') });
}

export default function ClosePhase({ recap, elapsedSeconds, targetSeconds, onFinish }: ClosePhaseProps) {
  const t = useT();
  const [reflection, setReflection] = useState('');
  const beatPlan = elapsedSeconds < targetSeconds;

  return (
    <div className={styles.card}>
      <p className={styles.recapLine}>{recapLine(recap, t)}</p>

      {beatPlan ? (
        <p className={styles.celebrateLine}>{formatElapsed(elapsedSeconds)} {t('shift.closePhase.beatPlanSuffix')}</p>
      ) : null}

      <textarea
        className={styles.reflectionInput}
        placeholder={t('shift.closePhase.reflectionPlaceholder')}
        aria-label={t('shift.closePhase.reflectionAria')}
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
      />

      <div className={styles.reflectionActions}>
        <button type="button" className={styles.secondaryButton} onClick={() => onFinish(reflection || undefined)}>
          {t('shift.closePhase.saveFinishCta')}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => onFinish(undefined)}>
          {t('shift.closePhase.skipCta')}
        </button>
      </div>
    </div>
  );
}
