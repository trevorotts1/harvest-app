// T-41 (WP06 §11.6 "Template system") — the 20+ doctrine-verified template library. Reached from the
// Content Queue page's "Template library" link.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import styles from '../content.module.css';

interface TemplateData {
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

export default function TemplateLibraryPage() {
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
        setError('Could not load the template library.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const categories = ['ALL', ...Array.from(new Set(templates.map((t) => t.category).filter(Boolean)))] as string[];
  const visible = filter === 'ALL' ? templates : templates.filter((t) => t.category === filter);

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <Link href="/content" className={styles.secondaryLink}>
          Back to Content Queue
        </Link>
        <h1 className={styles.title}>Template Library</h1>
        <p className={styles.subtitle}>{templates.length} doctrine-verified templates across every category — automatic, AI-inferred, and rep-provided personalization.</p>

        {loading && <p className={styles.loadingState}>Loading templates…</p>}
        {error && <p className={styles.errorState}>{error}</p>}

        {!loading && !error && (
          <>
            <div className={styles.filterRow}>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.filterChip} ${filter === c ? styles.filterChipActive : ''}`}
                  onClick={() => setFilter(c)}
                >
                  {c.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
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
        )}
      </div>
    </div>
  );
}
