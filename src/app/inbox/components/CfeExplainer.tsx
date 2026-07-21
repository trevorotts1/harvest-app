// T-57 R3c-2 (findings A4; uiux §6.1 point 3 "Understandable" + AC-6-2: "plain-language compliance
// explanations are reachable from every CFE chip and banner" — verbatim example given there: "This
// message sounded like an income promise, which the rules don't allow — here's a version that
// keeps the meaning."). Before this fix: `cfeChip()` (ApprovalInboxItem.tsx) rendered a technical
// label only (Pass/Flagged/Blocked + a bare risk-score number); `ClassifierAdjudicationDrawer.tsx`
// exposes classifier-by-classifier confidences but is itself a buried `<details>` a rep must already
// choose to open, and even then never restates the verdict in plain English. This component is
// mounted directly next to the CFE chip AND inside the held banner (ApprovalInboxItem.tsx) — NOT
// nested inside the adjudication drawer — so it is reachable without opening anything else first.
//
// Native <details>/<summary>, same accessible-disclosure convention as ClassifierAdjudicationDrawer
// (free keyboard/AT toggle semantics; its content is always present in server-rendered markup, only
// visually collapsed by the browser's native UA styling — verified against this repo's own
// `renderToStaticMarkup`-only test convention, jest.config.js has no jsdom).
//
// `plainLanguageSentence` is exported as a pure function specifically so it is directly unit-testable
// without needing to simulate a click in an environment that has no DOM (this repo's Jest suite runs
// `testEnvironment: 'node'`).

'use client';

import styles from '../inbox.module.css';
import { useT } from '@/app/locale-context';
import type { TVars } from '@/lib/i18n/catalog';

export type CfeExplainerOutcome = 'PASS' | 'FLAG' | 'BLOCK' | 'RECORDED' | null;

type Translate = (key: string, vars?: TVars) => string;

interface ClassifierResultLike {
  classifier: string;
  confidence: number;
}

/** The classifier code -> plain-English "reason" catalog key. Mirrors
 *  ClassifierAdjudicationDrawer.tsx's own `CLASSIFIER_LABELS` classifier set exactly (same five
 *  codes), but maps to a plain-English NOUN PHRASE ("an income promise") rather than a technical
 *  label ("Income claim") — the whole point of AC-6-2. */
const REASON_KEY_BY_CLASSIFIER: Record<string, string> = {
  INCOME_CLAIM: 'cfeExplainer.reason.incomeClaim',
  TESTIMONIAL: 'cfeExplainer.reason.testimonial',
  OPPORTUNITY: 'cfeExplainer.reason.opportunity',
  INSURANCE: 'cfeExplainer.reason.insurance',
  REFERRAL: 'cfeExplainer.reason.referral',
};

/** Defensive local coercion — mirrors ClassifierAdjudicationDrawer.tsx's own `coerce()` exactly (a
 *  null/legacy/misshapen value resolves to "no signal", never throws). Returns the HIGHEST-confidence
 *  classifier only — the plain-English sentence names the single most relevant reason, not every
 *  classifier that fired at any confidence. */
function topClassifier(data: unknown): string | null {
  if (!Array.isArray(data)) return null;
  let best: ClassifierResultLike | null = null;
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.classifier === 'string' && typeof r.confidence === 'number' && r.confidence > 0) {
      if (!best || r.confidence > best.confidence) best = { classifier: r.classifier, confidence: r.confidence };
    }
  }
  return best?.classifier ?? null;
}

/**
 * Computes the ONE-SENTENCE plain-English restatement of a CFE decision (AC-6-2). Exported (not
 * component-private) so it is independently unit-testable in both EN and ES without rendering
 * anything.
 */
export function plainLanguageSentence(outcome: CfeExplainerOutcome, classifierData: unknown, t: Translate): string {
  const classifier = topClassifier(classifierData);
  const reasonKey = classifier ? REASON_KEY_BY_CLASSIFIER[classifier] : undefined;
  const reason = t(reasonKey ?? 'cfeExplainer.reason.generic');

  if (outcome === 'BLOCK') {
    return reasonKey
      ? t('cfeExplainer.sentence.blockWithReason', { reason })
      : t('cfeExplainer.sentence.blockGeneric');
  }
  if (outcome === 'FLAG') {
    return reasonKey ? t('cfeExplainer.sentence.flagWithReason', { reason }) : t('cfeExplainer.sentence.flagGeneric');
  }
  if (outcome === 'RECORDED') {
    return t('cfeExplainer.sentence.recorded');
  }
  return t('cfeExplainer.sentence.pass');
}

export interface CfeExplainerProps {
  outcome: CfeExplainerOutcome;
  classifierData?: unknown;
  /** Distinguishes independent mount points on the SAME item (chip vs. held banner) so their
   *  `id`s never collide when both render for one draft. */
  idSuffix: string;
}

export default function CfeExplainer({ outcome, classifierData, idSuffix }: CfeExplainerProps) {
  const t = useT();
  const sentence = plainLanguageSentence(outcome, classifierData, t);

  return (
    <details className={styles.cfeExplainer} data-testid={`cfe-explainer-${idSuffix}`}>
      <summary className={styles.cfeExplainerTrigger}>{t('cfeExplainer.trigger')}</summary>
      {/* `role="status"` (polite) — deliberately NOT `role="alert"`; assertive is reserved for
          compliance holds only (uiux §6.1 point 4), and the held banner's own alert text already
          carries that role independently of this explainer. */}
      <p className={styles.cfeExplainerPanel} role="status">
        {sentence}
      </p>
    </details>
  );
}
