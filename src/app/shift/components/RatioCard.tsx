// T-34 (master-spec §9.7 "the two ratios", §9.5 item 5) — a single ratio card. Always renders the
// headline number ALONGSIDE its title and a "what this means" explainer — the spec requires both
// ratios to display WITH explainers (§9.9-7), unlike the Readiness Score elsewhere in this codebase
// (uiux §5.4 AC-5.4-4), which is deliberately never shown. A headline is never rendered alone.

import type { RatioCardView } from '@/types/learning-state';
import styles from '../shift.module.css';

export interface RatioCardProps {
  title: string;
  view: RatioCardView;
}

export default function RatioCard({ title, view }: RatioCardProps) {
  return (
    <div className={styles.ratioCard} role="group" aria-label={title}>
      <p className={styles.ratioCardTitle}>{title}</p>
      <p className={styles.ratioHeadline}>{view.headline.join(' : ')}</p>
      {view.learningLabel ? <span className={styles.learningBadge}>{view.learningLabel}</span> : null}
      <p className={styles.ratioExplainer}>{view.explainer}</p>
    </div>
  );
}
