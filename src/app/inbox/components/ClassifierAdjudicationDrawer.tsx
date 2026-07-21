// T-09 (master-spec §5.5 AC-1 "surface classifier-by-classifier confidences + risk score +
// recommended action + suggested rewrite in the Approval Inbox"). An ADDITIVE, self-contained
// disclosure sub-component — deliberately kept OUT of ApprovalInboxItem.tsx's body (a concurrent
// i18n unit also edits that file) so the only change there is a single import + one render line.
//
// Presentational only: it renders whatever it is handed and NEVER decides/approves anything. On the
// rep's own Approval Inbox it shows the classifier breakdown + risk score off the draft's persisted
// CFE data (recommendation props absent). On the upline's compliance-review surface it additionally
// shows the ADVISORY Sonnet-5 / Opus-4.8 recommended action + suggested rewrite (AC-2/AC-7) — always
// labelled "Recommendation (advisory)" so it can never be mistaken for a decision.
//
// T-57 R3c-2 (findings A4) — reuses `CfeExplainer.tsx`'s `plainLanguageSentence` to ALSO surface the
// one-sentence plain-English restatement at the top of this drawer's body, when a caller supplies
// `cfeOutcome` (optional — every existing caller that omits it keeps compiling and renders exactly
// as before, no plain-language line). This is a bonus consistency touch, not the primary reachability
// fix for AC-6-2: the primary fix (reachable directly from the chip/banner, not buried behind this
// already-collapsed `<details>`) lives in ApprovalInboxItem.tsx's own two new `CfeExplainer` mounts.

'use client';

import styles from '../inbox.module.css';
import { useT } from '@/app/locale-context';
import { plainLanguageSentence, type CfeExplainerOutcome } from './CfeExplainer';

interface ClassifierResultLike {
  classifier: string;
  confidence: number;
  matched_patterns?: string[];
}

export interface ClassifierAdjudicationDrawerProps {
  /** The draft's persisted `cfe_classifier_data` (a `ClassifierResult[]`, loosely typed here). */
  classifierData?: unknown;
  riskScore?: number | null;
  /** ADVISORY (upline surface only) — the Sonnet-5 / Opus-4.8 recommendation. */
  recommendedAction?: string | null;
  suggestedRewrite?: string | null;
  /** 'sonnet_5' | 'opus_4_8' — which Claude tier produced the advisory recommendation. */
  recommendationModel?: string | null;
  /** 'classifier_conflict' | 'novel_pattern' — why Opus was escalated to (AC-7). */
  escalationReason?: string | null;
  /** T-57 R3c-2 (findings A4) — optional; when supplied, the drawer's body opens with the same
   *  plain-English restatement `CfeExplainer` shows at the chip/banner (consistency, not the
   *  primary fix — see this file's header note). */
  cfeOutcome?: CfeExplainerOutcome;
}

const CLASSIFIER_LABELS: Record<string, string> = {
  INCOME_CLAIM: 'Income claim',
  TESTIMONIAL: 'Testimonial',
  OPPORTUNITY: 'Opportunity',
  INSURANCE: 'Insurance',
  REFERRAL: 'Referral',
};

const MODEL_LABELS: Record<string, string> = {
  sonnet_5: 'Sonnet 5',
  opus_4_8: 'Opus 4.8',
};

const ESCALATION_LABELS: Record<string, string> = {
  classifier_conflict: 'classifiers conflicted',
  novel_pattern: 'novel pattern detected',
};

/** Defensive local coercion — a null/legacy/misshapen value renders as "no signal", never throws. */
function coerce(data: unknown): ClassifierResultLike[] {
  if (!Array.isArray(data)) return [];
  const out: ClassifierResultLike[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.classifier === 'string' && typeof r.confidence === 'number') {
      out.push({ classifier: r.classifier, confidence: r.confidence });
    }
  }
  return out;
}

export default function ClassifierAdjudicationDrawer({
  classifierData,
  riskScore,
  recommendedAction,
  suggestedRewrite,
  recommendationModel,
  escalationReason,
  cfeOutcome,
}: ClassifierAdjudicationDrawerProps) {
  const t = useT();
  const results = coerce(classifierData)
    .filter((r) => r.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  return (
    <details className={styles.adjudicationDrawer}>
      <summary className={styles.adjudicationSummary}>
        {t('inbox.adjudication.complianceDetail')}{typeof riskScore === 'number' ? ` · risk ${riskScore}` : ''}
      </summary>

      <div className={styles.adjudicationBody}>
        {cfeOutcome !== undefined && (
          <p className={styles.cfeExplainerPanel} role="status">
            {plainLanguageSentence(cfeOutcome, classifierData, t)}
          </p>
        )}
        <p className={styles.adjudicationHeading}>{t('inbox.adjudication.classifierSignals')}</p>
        {results.length === 0 ? (
          <p className={styles.itemMeta}>{t('inbox.adjudication.noSignal')}</p>
        ) : (
          <ul className={styles.classifierList}>
            {results.map((r) => {
              const pct = Math.round(r.confidence * 100);
              return (
                <li key={r.classifier} className={styles.classifierRow}>
                  <span className={styles.classifierName}>
                    {CLASSIFIER_LABELS[r.classifier] ?? r.classifier}
                  </span>
                  <span className={styles.classifierTrack} aria-hidden="true">
                    <span className={styles.classifierFill} style={{ width: `${pct}%` }} />
                  </span>
                  <span className={styles.classifierPct}>{pct}%</span>
                </li>
              );
            })}
          </ul>
        )}

        {recommendedAction ? (
          <div className={styles.recommendationBlock}>
            <p className={styles.adjudicationHeading}>
              {t('inbox.adjudication.recommendationLabel')}
              {recommendationModel && MODEL_LABELS[recommendationModel]
                ? ` · ${MODEL_LABELS[recommendationModel]}`
                : ''}
              {escalationReason && ESCALATION_LABELS[escalationReason]
                ? ` · ${ESCALATION_LABELS[escalationReason]}`
                : ''}
              )
            </p>
            <p className={styles.itemBody}>{recommendedAction}</p>
            {suggestedRewrite ? (
              <>
                <p className={styles.adjudicationHeading}>{t('inbox.adjudication.suggestedRewrite')}</p>
                <p className={styles.suggestedRewrite}>{suggestedRewrite}</p>
              </>
            ) : null}
            <p className={styles.itemMeta}>
              {t('inbox.adjudication.advisoryOnly')}
            </p>
          </div>
        ) : null}
      </div>
    </details>
  );
}
