// T-45 (WP09 §14.5 P0; uiux §5.9 item 7, AC-5.9-6) — the Sponsor Cockpit + the enterprise admin
// console extension (P1, desktop-first, shown only when the caller's role is granted the
// `enterprise_console` capability — a plain 403 from that fetch hides the section rather than
// erroring the page).

'use client';

import { useCallback, useEffect, useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { formatDate } from '@/lib/i18n/format';
import { enterpriseSeatStatusLabel } from '@/lib/i18n/team-token-display';

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
  const { locale, t } = useLocale();
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

  if (cockpit.kind === 'loading') return <div className="card panel"><p>{t('team.cockpit.loading')}</p></div>;
  if (cockpit.kind === 'failed') {
    return (
      <div className="card panel">
        <p>{t('team.cockpit.loadFailed')}</p>
        <button type="button" className="btn btn-secondary" onClick={loadCockpit}>{t('common.retry')}</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">{t('team.layout.cockpitLink')}</span>
        {!cockpit.hasSponsees ? (
          <>
            <h2 style={{ marginTop: 8 }}>{t('team.cockpit.emptyHeading')}</h2>
            <p>{t('team.cockpit.emptyBody')}</p>
          </>
        ) : (
          <div className="stack" style={{ marginTop: 12 }}>
            {cockpit.seats.map((seat) => (
              <div className="metric" key={seat.memberUserId}>
                <strong>{seat.memberName}</strong>
                <div>{t('team.cockpit.statusLabel')} {seat.activationStatus} ({seat.sponsorshipState})</div>
                <div>{t('team.cockpit.seatCostLabel')}{(seat.seatCostCents / 100).toFixed(2)}</div>
                <div>{t('team.cockpit.recruitsActivatedLabel')} {seat.recruitsActivated} {t('team.cockpit.appointmentsGeneratedLabel')} {seat.appointmentsGenerated}</div>
                {seat.renewalDate && <div>{t('team.cockpit.renewsLabel')} {formatDate(locale, seat.renewalDate)}</div>}
                <p style={{ fontStyle: 'italic' }}>{seat.roiNote}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {enterprise.kind === 'ready' && (
        <section className="card panel">
          <span className="badge">{t('team.cockpit.enterpriseConsoleBadge')}</span>
          <h3 style={{ marginTop: 8 }}>{t('team.cockpit.seatPoolHeading')}</h3>
          <ul>
            {/* T-57 RG6 (i18n) — was `{s.status}`: the raw `EnterpriseSeatAssignment.status` token
                (`ACTIVE`/`REVOKED`) rendered verbatim. `enterpriseSeatStatusLabel`
                (`@/lib/i18n/team-token-display.ts`) maps the known values to catalog labels, with a
                generic localized fallback for any future value. */}
            {enterprise.seats.map((s) => (
              <li key={s.id}>{s.assigned_user_id} — {enterpriseSeatStatusLabel(t, s.status)}</li>
            ))}
            {enterprise.seats.length === 0 && <li>{t('team.cockpit.noSeatsAssigned')}</li>}
          </ul>
          <h3>{t('team.cockpit.orgAnalyticsHeading')}</h3>
          <p>{enterprise.narrative?.narrativeText ?? t('team.cockpit.noNarrativeYet')}</p>
          <button type="button" className="btn btn-secondary" onClick={refreshNarrative}>{t('team.cockpit.refreshNarrativeCta')}</button>
        </section>
      )}
    </div>
  );
}
