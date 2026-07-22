// uiux §4.6 — the Community home's plot chip row + contact cards. Composes `PlotsRow` +
// `ContactCard` over `/api/contacts/pipeline` — the REAL, session-scoped, ownership-filtered,
// DECRYPTED contact read (T-23's `PipelineService.getPipelineSummary`, wired in by T-R10; no
// demo/mock fallback here anymore). Toggling a card's flags calls the REAL `/api/contacts/flags`
// route (T-28) against these same real contact ids, so the write-path no longer 404s on this page —
// see tests/unit/contact-flags.test.ts for the write-path's own proof and
// tests/unit/pipeline-route.test.ts / tests/unit/warm-market.test.ts for this read-path's
// session-scoping + ownership proof.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { useT } from '@/app/locale-context';
import { pipelineStageLabel } from '@/lib/i18n/team-token-display';
import { StatusMessage } from '@/components/StatusMessage';
import ContactCard, { type RecencyState } from './components/ContactCard';
import PlotsRow, { type Plot } from './components/PlotsRow';
import styles from './community.module.css';

interface PipelineContact {
  id: string;
  name: string;
  pipelineStage: string;
  relationshipStrength: number;
  isRecruitTarget: boolean;
  isClient: boolean;
}

interface FlagState {
  isRecruitTarget: boolean;
  isClient: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

function recencyFromStrength(strength: number): RecencyState {
  if (strength >= 70) return 'leaf';
  if (strength >= 40) return 'soil';
  return 'hollow';
}

export default function CommunityPage() {
  const t = useT();
  const [plots, setPlots] = useState<Plot[]>([]);
  const [contacts, setContacts] = useState<PipelineContact[]>([]);
  const [selectedPlot, setSelectedPlot] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<string, FlagState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggleNotice, setToggleNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/contacts/pipeline');
      if (!res.ok) {
        setError(t('community.loadError'));
        setPlots([]);
        setContacts([]);
        return;
      }
      const body = await res.json();
      // T-57 RG9 (i18n; master-spec §17.5, uiux §6.2/§0.5) — the plot-chip name was the raw
      // de-snake-cased `PipelineStage` enum (`s.stage.replaceAll('_', ' ')`), so a Spanish rep saw
      // every stage in English and the CLOSED_RECRUIT stage rendered off-vocabulary. Route it through
      // the shipping `pipelineStageLabel` mapper (per-value catalog keys, doctrine-clean "teammate",
      // generic localized fallback) — the same mapper the /team surfaces already use.
      const nextPlots: Plot[] = (body.summary ?? []).map((s: { stage: string; count: number }) => ({
        key: s.stage,
        name: pipelineStageLabel(t, s.stage),
        count: s.count,
      }));
      const flat: PipelineContact[] = (body.summary ?? []).flatMap(
        (s: {
          stage: string;
          contacts: {
            id: string;
            name: string;
            relationshipStrength: number;
            isRecruitTarget: boolean;
            isClient: boolean;
          }[];
        }) =>
          s.contacts.map((c) => ({
            id: c.id,
            name: c.name,
            pipelineStage: s.stage,
            relationshipStrength: c.relationshipStrength,
            isRecruitTarget: c.isRecruitTarget,
            isClient: c.isClient,
          }))
      );
      setPlots(nextPlots);
      setContacts(flat);
      // Seed each card's flag toggles from the REAL persisted state (not an assumed-false
      // default) — a rep who reloads this page sees their actual is_recruit_target/is_client
      // flags, not a reset toggle.
      setFlags(
        Object.fromEntries(
          flat.map((c) => [c.id, { isRecruitTarget: c.isRecruitTarget, isClient: c.isClient }])
        )
      );
    } catch {
      setError(t('community.loadError'));
      setPlots([]);
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleFlag(id: string, field: 'isRecruitTarget' | 'isClient', next: boolean) {
    setToggleNotice(null);
    setFlags((prev) => {
      const current: FlagState = prev[id] ?? { isRecruitTarget: false, isClient: false };
      return { ...prev, [id]: { ...current, [field]: next } };
    });

    const res = await fetch('/api/contacts/flags', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: id, [field]: next }),
    });
    if (!res.ok) {
      // A real contact id can still fail here (deleted between load and toggle, a transient
      // error, etc.) — this is a genuine failure notice, not the old "this is demo data" excuse.
      setToggleNotice(t('community.toggleError'));
      // Roll the optimistic update back so the toggle reflects the persisted state.
      setFlags((prev) => {
        const current: FlagState = prev[id] ?? { isRecruitTarget: false, isClient: false };
        return { ...prev, [id]: { ...current, [field]: !next } };
      });
    }
  }

  const visible = selectedPlot ? contacts.filter((c) => c.pipelineStage === selectedPlot) : contacts;

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>{t('community.title')}</h1>
          <div className={styles.headerRow}>
            {/* T-R30 (parity GAP 1) reachability wiring — the real CSV import surface linked from
                an existing, already-reached nav point (§13's "no orphaned components" mandate),
                same convention as the Grow link below. */}
            <Link href="/community/import" className={styles.growLink}>
              {t('community.importContacts')}
            </Link>
            {/* WP08 reachability wiring — the Orchard/Grow surface linked from an existing,
                already-reached nav point (§13's "no orphaned components" mandate). */}
            <Link href="/grow" className={styles.growLink}>
              {t('community.growLink')}
            </Link>
          </div>
        </div>

        <PlotsRow
          plots={plots}
          selectedKey={selectedPlot}
          onSelect={setSelectedPlot}
        />

        {toggleNotice && <StatusMessage className={styles.needsInfoNote}>{toggleNotice}</StatusMessage>}

        {loading && <p className={styles.loadingState}>{t('community.loading')}</p>}

        {!loading && error && (
          <div className={styles.errorState}>
            <StatusMessage>{error}</StatusMessage>
            <button type="button" className={styles.retryButton} onClick={() => load()}>
              {t('community.retry')}
            </button>
          </div>
        )}

        {!loading && !error && contacts.length === 0 && (
          <p className={styles.emptyState}>{t('community.emptyState')}</p>
        )}

        {!loading && !error && contacts.length > 0 && (
          <div className={styles.cardGrid}>
            {visible.map((c) => {
              const f = flags[c.id] ?? { isRecruitTarget: false, isClient: false };
              return (
                <ContactCard
                  key={c.id}
                  id={c.id}
                  name={c.name}
                  initials={initials(c.name)}
                  closeness={Math.round(c.relationshipStrength / 20)}
                  recency={recencyFromStrength(c.relationshipStrength)}
                  isRecruitTarget={f.isRecruitTarget}
                  isClient={f.isClient}
                  onToggleRecruitTarget={(id, next) => toggleFlag(id, 'isRecruitTarget', next)}
                  onToggleClient={(id, next) => toggleFlag(id, 'isClient', next)}
                  segmentTag={pipelineStageLabel(t, c.pipelineStage)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
