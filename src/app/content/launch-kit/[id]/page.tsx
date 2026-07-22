// T-41 (WP06 §11.4 "Launch kit builder") — the whole-kit review page. Reached from the Content Queue
// page's "View launch kit" link on any of its pieces. Shows the real photo (or the initials-avatar
// fallback — never a stock substitute), every piece's own state, and the whole-kit hold banner when
// any piece is BLOCKED.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import styles from '../../content.module.css';
import { useT } from '@/app/locale-context';
import { reasonDisplay } from '@/lib/i18n/reason-display';
import { launchKitPieceTypeLabel, launchKitVersionLabel, welcomeVariantLabel, contentStateLabel } from '@/lib/i18n/content-token-display';
import { StatusMessage } from '@/components/StatusMessage';

interface KitData {
  kit: {
    id: string;
    new_member_first_name: string;
    welcome_variant: string;
    version: string;
    state: 'DRAFTING' | 'HELD_FOR_REVIEW' | 'READY_FOR_REVIEW' | 'APPROVED' | 'WITHDRAWN_TO_DRAFTS';
    photo_url: string | null;
    held_reason: string | null;
  };
  items: {
    id: string;
    launch_kit_piece_type: string | null;
    headline: string | null;
    body: string;
    state: string;
    vocab_clean: boolean;
  }[];
}

interface PageProps {
  params: { id: string };
}

export default function LaunchKitPage({ params }: PageProps) {
  const t = useT();
  const { id } = params;
  const [data, setData] = useState<KitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/content/launch-kit/${id}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(t('content.launchKit.loadFailedGeneric'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function approveKit() {
    const res = await fetch(`/api/content/launch-kit/${id}/approve`, { method: 'POST' });
    if (res.ok) await load();
  }

  async function withdrawKit() {
    const res = await fetch(`/api/content/launch-kit/${id}/withdraw`, { method: 'POST' });
    if (res.ok) await load();
  }

  if (loading) return <div className={styles.page}><p className={styles.loadingState}>{t('content.launchKit.loading')}</p></div>;
  if (error || !data) return <div className={styles.page}><StatusMessage className={styles.errorState}>{error ?? t('content.launchKit.notFound')}</StatusMessage></div>;

  const { kit, items } = data;
  const anyBlocked = items.some((i) => i.state === 'BLOCKED');

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <Link href="/content" className={styles.secondaryLink}>
          {t('content.launchKit.backToQueueCta')}
        </Link>
        <h1 className={styles.title}>{t('content.launchKit.titlePrefix')} {kit.new_member_first_name}</h1>
        {/* T-57 RG6 (i18n) — was `{kit.version.replace(/_/g, ' ')} … {kit.welcome_variant.replace(/_/g,
            ' ').toLowerCase()}`: the raw `LaunchKitVersion`/`WelcomeVariant` tokens, merely
            de-snake-cased, never translated. `welcomeVariantLabel` reuses `content/page.tsx`'s own
            `LaunchKitTrigger` <select> catalog keys (single source of truth for the 3 known
            values). */}
        <p className={styles.subtitle}>
          {launchKitVersionLabel(t, kit.version)} {t('content.launchKit.joinedViaSeparator')} {welcomeVariantLabel(t, kit.welcome_variant)}
        </p>

        {kit.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={kit.photo_url} alt={t('content.launchKit.photoAlt', { name: kit.new_member_first_name })} width={96} height={96} style={{ borderRadius: '999px' }} />
        ) : (
          <p className={styles.itemMeta}>{t('content.launchKit.noPhotoNotice')}</p>
        )}

        {kit.state === 'HELD_FOR_REVIEW' && (
          <div className={styles.pausedBanner} role="alert">
            {/* T-57 RG4 (B leak) — the raw `held_reason` machine token
                (`one_or_more_pieces_blocked_by_compliance_or_doctrine`) was spliced in verbatim; now
                resolved to localized copy via `reasonDisplay`, which keeps saying it's a compliance
                hold in both languages (see reason-display.ts's security note). */}
            {t('content.launchKit.wholeKitHoldPrefix')}{reasonDisplay(t, kit.held_reason)}{t('content.launchKit.wholeKitHoldSuffix')}
          </div>
        )}

        <div className={styles.itemList}>
          {items.map((item) => (
            <div key={item.id} className={`${styles.item} ${item.state === 'BLOCKED' ? styles.itemBlocked : ''}`}>
              {/* T-57 RG6 (i18n) — was `{item.launch_kit_piece_type?.replace(/_/g, ' ')}`: the raw
                  `LaunchKitPieceType` token, merely de-snake-cased, never translated. The `item.state`
                  chip (a bare `ContentQueueState` render, same enum `content/page.tsx`'s state chip
                  uses) is fixed alongside it via the same `contentStateLabel` mapper for consistency
                  across this every-rep-facing surface. */}
              <div className={styles.itemHeader}>
                <span>{launchKitPieceTypeLabel(t, item.launch_kit_piece_type)}</span>
                <span className={styles.stateChip}>{contentStateLabel(t, item.state)}</span>
              </div>
              {item.headline && <p className={styles.headline}>{item.headline}</p>}
              <p className={styles.itemBody}>{item.body}</p>
              {!item.vocab_clean && <p className={styles.violationNote}>{t('content.launchKit.pieceNeedsRevision')}</p>}
            </div>
          ))}
        </div>

        <div className={styles.itemFooter}>
          <button type="button" className={styles.primaryButton} onClick={approveKit} disabled={anyBlocked || kit.state === 'APPROVED'}>
            {t('content.launchKit.approveKitCta')}
          </button>
          <button type="button" className={`${styles.actionButton} ${styles.declineButton}`} onClick={withdrawKit}>
            {t('content.launchKit.withdrawKitCta')}
          </button>
        </div>
      </div>
    </div>
  );
}
