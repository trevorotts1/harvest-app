// T-55 (master-spec §17.7 / uiux §4.13) — the Template Library's filter row + list, extracted from
// TemplateLibraryPage so the zero-visible (filtered-to-zero, or a genuine zero-template) case is
// independently testable via `renderToStaticMarkup` without needing a live fetch (this repo's Jest
// config runs `testEnvironment: 'node'` — see jest.config.js — the same seam convention as
// CourseModulesList.tsx / ConversationTimeline.tsx).
//
// Before this extraction, a filtered-to-zero category (or a genuine zero-template response) rendered
// an empty `itemList` div with no narrative at all — a narrative-free blank region (SC9).

import styles from '../../content.module.css';
import { useT } from '@/app/locale-context';

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
  const t = useT();
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
          {t('content.templates.list.emptyState')}{' '}
          {filter !== 'ALL' && (
            <button type="button" className={styles.secondaryLink} onClick={() => onSelectFilter('ALL')} style={{ cursor: 'pointer' }}>
              {t('content.templates.list.showAllCta')}
            </button>
          )}
        </p>
      )}

      <div className={styles.itemList}>
        {visible.map((tpl) => (
          <div key={tpl.key} className={styles.item}>
            <div className={styles.itemHeader}>
              <p className={styles.headline}>{tpl.name}</p>
              <span className={styles.stateChip}>{tpl.contentType}</span>
            </div>
            <p className={styles.itemBody}>{tpl.copySkeleton}</p>
            {tpl.imageConceptPrompt && <p className={styles.itemMeta}>{t('content.templates.list.imageConceptLabel')} {tpl.imageConceptPrompt}</p>}
            <p className={styles.itemMeta}>
              {t('content.templates.list.toneLabel')} {tpl.toneGuidance} {t('content.templates.list.personalizationSeparator')} {tpl.defaultPersonalizationTier.replace(/_/g, ' ').toLowerCase()} · v{tpl.version} {t('content.templates.list.doctrineVerifiedSuffix')}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
