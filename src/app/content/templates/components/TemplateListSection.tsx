// T-55 (master-spec §17.7 / uiux §4.13) — the Template Library's filter row + list, extracted from
// TemplateLibraryPage so the zero-visible (filtered-to-zero, or a genuine zero-template) case is
// independently testable via `renderToStaticMarkup` without needing a live fetch (this repo's Jest
// config runs `testEnvironment: 'node'` — see jest.config.js — the same seam convention as
// CourseModulesList.tsx / ConversationTimeline.tsx).
//
// Before this extraction, a filtered-to-zero category (or a genuine zero-template response) rendered
// an empty `itemList` div with no narrative at all — a narrative-free blank region (SC9).

import styles from '../../content.module.css';

export interface TemplateData {
  key: string;
  name: string;
  contentType: string;
  category: string | null;
  launchKitPieceType: string | null;
  copySkeleton: string;
  imageConceptPrompt: string | null;
  toneGuidance: string;
  doctrineVerified: boolean;
  defaultPersonalizationTier: string;
  version: number;
}

export interface TemplateListSectionProps {
  categories: string[];
  filter: string;
  visible: TemplateData[];
  onSelectFilter: (category: string) => void;
}

export default function TemplateListSection({ categories, filter, visible, onSelectFilter }: TemplateListSectionProps) {
  return (
    <>
      <div className={styles.filterRow}>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.filterChip} ${filter === c ? styles.filterChipActive : ''}`}
            onClick={() => onSelectFilter(c)}
          >
            {c.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <p className={styles.emptyState}>
          No templates in this category yet.{' '}
          {filter !== 'ALL' && (
            <button type="button" className={styles.secondaryLink} onClick={() => onSelectFilter('ALL')} style={{ cursor: 'pointer' }}>
              Show all templates
            </button>
          )}
        </p>
      )}

      <div className={styles.itemList}>
        {visible.map((t) => (
          <div key={t.key} className={styles.item}>
            <div className={styles.itemHeader}>
              <p className={styles.headline}>{t.name}</p>
              <span className={styles.stateChip}>{t.contentType}</span>
            </div>
            <p className={styles.itemBody}>{t.copySkeleton}</p>
            {t.imageConceptPrompt && <p className={styles.itemMeta}>Image concept: {t.imageConceptPrompt}</p>}
            <p className={styles.itemMeta}>
              Tone: {t.toneGuidance} · Personalization: {t.defaultPersonalizationTier.replace(/_/g, ' ').toLowerCase()} · v{t.version} · doctrine-verified
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
