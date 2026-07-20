// T-45 (WP09 §14.5 P0; uiux §5.9 item 7, AC-5.9-6) — the Sponsor Cockpit + the enterprise admin
// console extension (P1, desktop-first, shown only when the caller's role is granted the
// `enterprise_console` capability — a plain 403 from that fetch hides the section rather than
// erroring the page).

'use client';

import { useCallback, useEffect, useState } from 'react';

interface SponsorSeat {
  memberUserId: string;
  memberName: string;
  activationStatus: string;
  sponsorshipState: string;
  seatCostCents: number;
  recruitsActivated: number;
  appointmentsGenerated: number;
  renewalDate: string | null;
  roiNote: string;
}

interface EnterpriseSeat {
  id: string;
  assigned_user_id: string;
  status: string;
}

type CockpitState = { kind: 'loading' } | { kind: 'ready'; seats: SponsorSeat[]; hasSponsees: boolean } | { kind: 'failed' };
type EnterpriseState = { kind: 'hidden' } | { kind: 'ready'; seats: EnterpriseSeat[]; narrative: { narrativeText: string } | null };

export default function SponsorCockpitPage() {
  const [cockpit, setCockpit] = useState<CockpitState>({ kind: 'loading' });
  const [enterprise, setEnterprise] = useState<EnterpriseState>({ kind: 'hidden' });

  const loadCockpit = useCallback(async () => {
    try {
      const res = await fetch('/api/team/cockpit');
      if (!res.ok) {
        setCockpit({ kind: 'failed' });
        return;
      }
      const data = (await res.json()) as { seats: SponsorSeat[]; hasSponsees: boolean };
      setCockpit({ kind: 'ready', seats: data.seats, hasSponsees: data.hasSponsees });
    } catch {
      setCockpit({ kind: 'failed' });
    }
  }, []);

  const loadEnterprise = useCallback(async () => {
    try {
      const res = await fetch('/api/team/enterprise');
      if (!res.ok) return; // 403 for non-RVP/admin — the console section simply doesn't render
      const data = (await res.json()) as { seats: EnterpriseSeat[]; narrative: { narrative_text: string } | null };
      setEnterprise({ kind: 'ready', seats: data.seats, narrative: data.narrative ? { narrativeText: data.narrative.narrative_text } : null });
    } catch {
      // stays hidden
    }
  }, []);

  useEffect(() => {
    loadCockpit();
    loadEnterprise();
  }, [loadCockpit, loadEnterprise]);

  const refreshNarrative = useCallback(async () => {
    const res = await fetch('/api/team/enterprise/narrative', { method: 'POST' });
    const data = await res.json();
    if (data.narrativeText) {
      setEnterprise((prev) => (prev.kind === 'ready' ? { ...prev, narrative: { narrativeText: data.narrativeText } } : prev));
    }
  }, []);

  if (cockpit.kind === 'loading') return <div className="card panel"><p>Loading the Sponsor Cockpit…</p></div>;
  if (cockpit.kind === 'failed') {
    return (
      <div className="card panel">
        <p>We can&apos;t reach the Sponsor Cockpit right now.</p>
        <button type="button" className="btn btn-secondary" onClick={loadCockpit}>Retry</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">Sponsor Cockpit</span>
        {!cockpit.hasSponsees ? (
          <>
            <h2 style={{ marginTop: 8 }}>You&apos;re not sponsoring anyone yet.</h2>
            <p>When you cover a new member&apos;s free tier, their activation, seat cost, and ROI story will show up here.</p>
          </>
        ) : (
          <div className="stack" style={{ marginTop: 12 }}>
            {cockpit.seats.map((seat) => (
              <div className="metric" key={seat.memberUserId}>
                <strong>{seat.memberName}</strong>
                <div>Status: {seat.activationStatus} ({seat.sponsorshipState})</div>
                <div>Seat cost this period: ${(seat.seatCostCents / 100).toFixed(2)}</div>
                <div>Recruits activated: {seat.recruitsActivated} · Appointments generated: {seat.appointmentsGenerated}</div>
                {seat.renewalDate && <div>Renews: {new Date(seat.renewalDate).toLocaleDateString()}</div>}
                <p style={{ fontStyle: 'italic' }}>{seat.roiNote}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {enterprise.kind === 'ready' && (
        <section className="card panel">
          <span className="badge">Enterprise console</span>
          <h3 style={{ marginTop: 8 }}>Seat pool</h3>
          <ul>
            {enterprise.seats.map((s) => (
              <li key={s.id}>{s.assigned_user_id} — {s.status}</li>
            ))}
            {enterprise.seats.length === 0 && <li>No enterprise seats assigned yet.</li>}
          </ul>
          <h3>Org analytics narrative</h3>
          <p>{enterprise.narrative?.narrativeText ?? 'No narrative generated yet.'}</p>
          <button type="button" className="btn btn-secondary" onClick={refreshNarrative}>Refresh narrative (Opus 4.8, batched)</button>
        </section>
      )}
    </div>
  );
}
