// T-41 (WP06 §11.4 "Launch kit builder") — the whole-kit review page. Reached from the Content Queue
// page's "View launch kit" link on any of its pieces. Shows the real photo (or the initials-avatar
// fallback — never a stock substitute), every piece's own state, and the whole-kit hold banner when
// any piece is BLOCKED.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import styles from '../../content.module.css';

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
      setError('Could not load this launch kit.');
    } finally {
      setLoading(false);
    }
  }, [id]);

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

  if (loading) return <div className={styles.page}><p className={styles.loadingState}>Loading the launch kit…</p></div>;
  if (error || !data) return <div className={styles.page}><p className={styles.errorState}>{error ?? 'Not found.'}</p></div>;

  const { kit, items } = data;
  const anyBlocked = items.some((i) => i.state === 'BLOCKED');

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <Link href="/content" className={styles.secondaryLink}>
          Back to Content Queue
        </Link>
        <h1 className={styles.title}>Launch kit for {kit.new_member_first_name}</h1>
        <p className={styles.subtitle}>
          {kit.version.replace(/_/g, ' ')} · joined via {kit.welcome_variant.replace(/_/g, ' ').toLowerCase()}
        </p>

        {kit.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={kit.photo_url} alt={`${kit.new_member_first_name}'s real onboarding photo`} width={96} height={96} style={{ borderRadius: '999px' }} />
        ) : (
          <p className={styles.itemMeta}>No photo on file — the share assets render an initials avatar (never a stock photo).</p>
        )}

        {kit.state === 'HELD_FOR_REVIEW' && (
          <div className={styles.pausedBanner} role="alert">
            WHOLE-KIT HOLD — one piece was blocked ({kit.held_reason}). The entire kit is held until every piece clears.
          </div>
        )}

        <div className={styles.itemList}>
          {items.map((item) => (
            <div key={item.id} className={`${styles.item} ${item.state === 'BLOCKED' ? styles.itemBlocked : ''}`}>
              <div className={styles.itemHeader}>
                <span>{item.launch_kit_piece_type?.replace(/_/g, ' ')}</span>
                <span className={styles.stateChip}>{item.state}</span>
              </div>
              {item.headline && <p className={styles.headline}>{item.headline}</p>}
              <p className={styles.itemBody}>{item.body}</p>
              {!item.vocab_clean && <p className={styles.violationNote}>This piece needs doctrine revision before the kit can proceed.</p>}
            </div>
          ))}
        </div>

        <div className={styles.itemFooter}>
          <button type="button" className={styles.primaryButton} onClick={approveKit} disabled={anyBlocked || kit.state === 'APPROVED'}>
            Approve whole kit
          </button>
          <button type="button" className={`${styles.actionButton} ${styles.declineButton}`} onClick={withdrawKit}>
            New member withdrew — move to drafts
          </button>
        </div>
      </div>
    </div>
  );
}
