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
import { contentCategoryLabel, contentTypeLabel, personalizationTierLabel } from '@/lib/i18n/content-token-display';

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
      {/* T-57 RG6 (i18n) — was `{c.replace(/_/g, ' ')}`: the raw `ContentCategory` token (or the
          synthesized `'ALL'` chip), merely de-snake-cased, never translated. `contentCategoryLabel`
          reuses `content.queue.filters.all` for `'ALL'` and the queue's own new `category.*` keys
          for the 5 real categories. */}
      <div className={styles.filterRow}>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.filterChip} ${filter === c ? styles.filterChipActive : ''}`}
            onClick={() => onSelectFilter(c)}
          >
            {contentCategoryLabel(t, c)}
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
              <span className={styles.stateChip}>{contentTypeLabel(t, tpl.contentType)}</span>
            </div>
            <p className={styles.itemBody}>{tpl.copySkeleton}</p>
            {tpl.imageConceptPrompt && <p className={styles.itemMeta}>{t('content.templates.list.imageConceptLabel')} {tpl.imageConceptPrompt}</p>}
            {/* T-57 RG6 (i18n) — was `{tpl.defaultPersonalizationTier.replace(/_/g, '
                ').toLowerCase()}`: the raw `PersonalizationTier` token, merely de-snake-cased, never
                translated. */}
            <p className={styles.itemMeta}>
              {t('content.templates.list.toneLabel')} {tpl.toneGuidance} {t('content.templates.list.personalizationSeparator')} {personalizationTierLabel(t, tpl.defaultPersonalizationTier)} · v{tpl.version} {t('content.templates.list.doctrineVerifiedSuffix')}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
