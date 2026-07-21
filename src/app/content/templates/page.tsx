// T-41 (WP06 §11.6 "Template system") — the 20+ doctrine-verified template library. Reached from the
// Content Queue page's "Template library" link.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import styles from '../content.module.css';
import TemplateListSection, { type TemplateData } from './components/TemplateListSection';
import { useT } from '@/app/locale-context';

export default function TemplateLibraryPage() {
  const t = useT();
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('ALL');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/content/templates');
        if (!res.ok) throw new Error();
        const body = await res.json();
        setTemplates(body.templates ?? []);
      } catch {
        setError(t('content.templates.loadFailedGeneric'));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  const categories = ['ALL', ...Array.from(new Set(templates.map((tpl) => tpl.category).filter(Boolean)))] as string[];
  const visible = filter === 'ALL' ? templates : templates.filter((tpl) => tpl.category === filter);

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <Link href="/content" className={styles.secondaryLink}>
          {t('content.launchKit.backToQueueCta')}
        </Link>
        <h1 className={styles.title}>{t('content.templates.title')}</h1>
        <p className={styles.subtitle}>{t('content.templates.subtitleTemplate', { count: templates.length })}</p>

        {loading && <p className={styles.loadingState}>{t('content.templates.loading')}</p>}
        {error && <p className={styles.errorState}>{error}</p>}

        {!loading && !error && (
          <TemplateListSection categories={categories} filter={filter} visible={visible} onSelectFilter={setFilter} />
        )}
      </div>
    </div>
  );
}
