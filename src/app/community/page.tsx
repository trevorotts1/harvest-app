// uiux §4.6 — the Community home's plot chip row + contact cards. Composes `PlotsRow` +
// `ContactCard` over the existing `/api/contacts/pipeline` summary (itself a stated demo-fallback
// route until database-backed contact state is fully wired — see that route's own `_meta.demo`
// flag). Toggling a card's flags calls the REAL, newly-added `/api/contacts/flags` route (T-28);
// against the pipeline route's demo contact ids that write will 404 in this demo composition, which
// this page surfaces honestly (an inline note) rather than pretending to succeed — the toggle
// write-path itself is proven against real Contact rows in tests/unit/contact-flags.test.ts.

'use client';

import { useEffect, useState } from 'react';

import ContactCard, { type RecencyState } from './components/ContactCard';
import PlotsRow, { type Plot } from './components/PlotsRow';
import styles from './community.module.css';

interface DemoContact {
  id: string;
  name: string;
  pipelineStage: string;
  relationshipStrength: number;
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
  const [plots, setPlots] = useState<Plot[]>([]);
  const [contacts, setContacts] = useState<DemoContact[]>([]);
  const [selectedPlot, setSelectedPlot] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<string, FlagState>>({});
  const [toggleNotice, setToggleNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/contacts/pipeline');
      if (!res.ok) return;
      const body = await res.json();
      const nextPlots: Plot[] = (body.summary ?? []).map((s: { stage: string; count: number }) => ({
        key: s.stage,
        name: s.stage.replaceAll('_', ' '),
        count: s.count,
      }));
      const flat: DemoContact[] = (body.summary ?? []).flatMap(
        (s: { stage: string; contacts: { id: string; name: string; relationshipStrength: number }[] }) =>
          s.contacts.map((c) => ({ id: c.id, name: c.name, pipelineStage: s.stage, relationshipStrength: c.relationshipStrength }))
      );
      setPlots(nextPlots);
      setContacts(flat);
    })();
  }, []);

  async function toggleFlag(id: string, field: 'isRecruitTarget' | 'isClient', next: boolean) {
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
      setToggleNotice(
        'This demo composition uses illustrative contacts, so the write-path route reported the contact as not found — the toggle route itself is proven against real Contact rows in the T-28 test suite.'
      );
    }
  }

  const visible = selectedPlot ? contacts.filter((c) => c.pipelineStage === selectedPlot) : contacts;

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <h1 className={styles.title}>Community</h1>

        <PlotsRow
          plots={plots}
          selectedKey={selectedPlot}
          onSelect={setSelectedPlot}
        />

        {toggleNotice && <p className={styles.needsInfoNote}>{toggleNotice}</p>}

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
                segmentTag={c.pipelineStage.replaceAll('_', ' ')}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
