// T-45 (WP09 §14.1/§14.4; uiux §5.9 item 5, AC-5.9-7) — the team calendar: the RVP-editable master
// calendar (read-only for reps, per §14.4) plus the caller's own merged personal agenda and
// Google/CalDAV connection status.

'use client';

import { useCallback, useEffect, useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { formatDateTime } from '@/lib/i18n/format';
import { errorDisplay } from '@/lib/i18n/error-display';
import { eventTypeLabel, agendaStatusLabel } from '@/lib/i18n/team-token-display';

interface BroadcastEvent {
  id: string;
  type: string;
  starts_at: string;
  myAttendanceState: string;
}

interface PersonalAgendaItem {
  id: string;
  kind: 'closing_appointment' | 'coaching_session';
  status: string;
  startsAt: string | null;
  endsAt: string | null;
}

interface CalendarData {
  broadcastEvents: BroadcastEvent[];
  personalAgenda: { appointments: PersonalAgendaItem[]; coachingSessions: PersonalAgendaItem[] };
  myUplineId: string | null;
}

interface LinkStatus {
  provider: string;
  status: string;
}

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: CalendarData } | { kind: 'failed' };

export default function TeamCalendarPage() {
  const { locale, t } = useLocale();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [links, setLinks] = useState<LinkStatus[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [coachingMessage, setCoachingMessage] = useState<string | null>(null);
  const [proposeContactId, setProposeContactId] = useState('');
  const [appointmentMessage, setAppointmentMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [calRes, linkRes] = await Promise.all([fetch('/api/team/calendar'), fetch('/api/team/calendar-link')]);
      if (!calRes.ok) {
        setState({ kind: 'failed' });
        return;
      }
      const data = (await calRes.json()) as CalendarData;
      setState({ kind: 'ready', data });
      if (linkRes.ok) {
        const linkData = (await linkRes.json()) as { links: LinkStatus[] };
        setLinks(linkData.links);
      }
    } catch {
      setState({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createEvent = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const res = await fetch('/api/team/calendar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: formData.get('type'), startsAt: formData.get('startsAt') }),
      });
      setCanCreate(res.status !== 403);
      await load();
    },
    [load]
  );

  const disconnect = useCallback(
    async (provider: string) => {
      await fetch(`/api/team/calendar-link?provider=${provider}`, { method: 'DELETE' });
      await load();
    },
    [load]
  );

  const proposeCoachingSession = useCallback(async () => {
    if (state.kind !== 'ready' || !state.data.myUplineId) {
      setCoachingMessage(t('team.calendar.noUplineOnFile'));
      return;
    }
    const res = await fetch('/api/team/coaching-sessions/propose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trainerId: state.data.myUplineId }),
    });
    const body = await res.json();
    if (body.outcome === 'flooding_declined') {
      setCoachingMessage(body.suggestion);
    } else if (body.outcome === 'booked') {
      setCoachingMessage(t('team.calendar.bookedWithUpline'));
    } else if (res.ok) {
      setCoachingMessage(t('team.calendar.proposedWaitingWindow'));
    } else {
      // T-57 RE-GATE B [af7789d3] Finding 1 — never render the raw English `body.error`; resolve a
      // locale-correct string from the `errors.*` catalog by the route's machine `code`.
      setCoachingMessage(errorDisplay(t, body.code));
    }
    await load();
  }, [state, load, t]);

  const proposeAppointment = useCallback(async () => {
    if (state.kind !== 'ready' || !state.data.myUplineId || !proposeContactId) {
      setAppointmentMessage(t('team.calendar.enterContactIdNotice'));
      return;
    }
    const res = await fetch('/api/team/appointments/propose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trainerId: state.data.myUplineId, contactId: proposeContactId }),
    });
    const body = await res.json();
    setAppointmentMessage(
      res.ok
        ? body.outcome === 'booked'
          ? t('team.calendar.appointmentBookedNotice')
          : t('team.calendar.appointmentProposedNotice')
        // T-57 RE-GATE B [af7789d3] Finding 1 — never render the raw English `body.error`; resolve
        // a locale-correct string from the `errors.*` catalog by the route's machine `code`.
        : errorDisplay(t, body.code)
    );
    await load();
  }, [state, proposeContactId, load, t]);

  if (state.kind === 'loading') return <div className="card panel"><p>{t('team.calendar.loading')}</p></div>;
  if (state.kind === 'failed') {
    return (
      <div className="card panel">
        <p>{t('team.calendar.loadFailed')}</p>
        <button type="button" className="btn btn-secondary" onClick={load}>{t('common.retry')}</button>
      </div>
    );
  }

  const { data } = state;
  const googleLink = links.find((l) => l.provider === 'google');
  const caldavLink = links.find((l) => l.provider === 'caldav_ios');

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">{t('team.calendar.connectionsBadge')}</span>
        <div className="stack" style={{ marginTop: 12 }}>
          <div>
            {t('team.calendar.googleLabel')} <strong>{googleLink?.status ?? t('team.calendar.notConnected')}</strong>
            {googleLink?.status === 'EXPIRED' && <span> {t('team.calendar.googleExpiredNotice')}</span>}
            {googleLink && <button type="button" className="btn btn-secondary" onClick={() => disconnect('google')} style={{ marginLeft: 8 }}>{t('team.calendar.disconnectCta')}</button>}
          </div>
          <div>
            {t('team.calendar.caldavLabel')} <strong>{caldavLink?.status ?? t('team.calendar.notConnected')}</strong>
            {caldavLink && <button type="button" className="btn btn-secondary" onClick={() => disconnect('caldav_ios')} style={{ marginLeft: 8 }}>{t('team.calendar.disconnectCta')}</button>}
          </div>
        </div>
      </section>

      <section className="card panel">
        <span className="badge">{t('team.calendar.broadcastBadge')}</span>
        <p>{t('team.calendar.broadcastIntro')}</p>
        <ul>
          {data.broadcastEvents.map((e) => (
            <li key={e.id}>
              {/* T-57 RG6 (i18n) — was `{e.type.replace(/_/g, ' ')}`: the raw `BroadcastEvent.type`
                  token, merely de-snake-cased, never translated. `eventTypeLabel` reuses this file's
                  own `team.calendar.eventType.*` <select> keys (below) via
                  `@/lib/i18n/team-token-display.ts` — single source of truth for the 4 known
                  values, generic fallback for any future one. */}
              {eventTypeLabel(t, e.type)} — {formatDateTime(locale, e.starts_at)} {t('team.calendar.attendanceLabel')} {e.myAttendanceState}
            </li>
          ))}
          {data.broadcastEvents.length === 0 && <li>{t('team.calendar.noUpcomingEvents')}</li>}
        </ul>
        <form
          onSubmit={createEvent}
          className="stack"
          style={{ marginTop: 12 }}
        >
          <label>
            {t('team.calendar.eventTypeLabel')}{' '}
            <select name="type" defaultValue="team_call">
              <option value="opportunity_night">{t('team.calendar.eventType.opportunityNight')}</option>
              <option value="training">{t('team.calendar.eventType.training')}</option>
              <option value="team_call">{t('team.calendar.eventType.teamCall')}</option>
              <option value="big_event">{t('team.calendar.eventType.bigEvent')}</option>
            </select>
          </label>
          <label>
            {t('team.calendar.startsAtLabel')} <input type="datetime-local" name="startsAt" required />
          </label>
          <button type="submit" className="btn btn-primary">{t('team.calendar.addEventCta')}</button>
          {!canCreate && <p style={{ color: 'var(--muted)' }}>{t('team.calendar.rvpOnlyNotice')}</p>}
        </form>
      </section>

      <section className="card panel">
        <span className="badge">{t('team.calendar.agendaBadge')}</span>
        <ul>
          {/* T-57 RG6 (i18n) — `a.status`/`c.status` used to render the raw `Appointment.status`/
              `CoachingSession.status` machine token verbatim (e.g. "RESCHEDULED"). `agendaStatusLabel`
              (`@/lib/i18n/team-token-display.ts`) maps the known values from both enums (a superset
              covers both, since both render through this same agenda list) to catalog labels, with a
              generic localized fallback for any future value. */}
          {data.personalAgenda.appointments.map((a) => (
            <li key={a.id}>{t('team.calendar.closingAppointmentPrefix')} {agendaStatusLabel(t, a.status)} — {a.startsAt ? formatDateTime(locale, a.startsAt) : t('team.calendar.proposedFallback')}</li>
          ))}
          {data.personalAgenda.coachingSessions.map((c) => (
            <li key={c.id}>{t('team.calendar.coachingSessionPrefix')} {agendaStatusLabel(t, c.status)} — {c.startsAt ? formatDateTime(locale, c.startsAt) : t('team.calendar.proposedFallback')}</li>
          ))}
          {data.personalAgenda.appointments.length === 0 && data.personalAgenda.coachingSessions.length === 0 && <li>{t('team.calendar.noAgendaItems')}</li>}
        </ul>
      </section>

      <section className="card panel">
        <span className="badge">{t('team.calendar.proposeCoachingBadge')}</span>
        <p>{t('team.calendar.proposeCoachingIntro')}</p>
        <button type="button" className="btn btn-primary" onClick={proposeCoachingSession}>{t('team.calendar.proposeCoachingCta')}</button>
        {coachingMessage && <p role="status" aria-live="polite" style={{ color: 'var(--muted)' }}>{coachingMessage}</p>}
      </section>

      <section className="card panel">
        <span className="badge">{t('team.calendar.proposeClosingBadge')}</span>
        <p>{t('team.calendar.proposeClosingIntro')}</p>
        <label>
          {t('team.calendar.contactIdLabel')}{' '}
          <input type="text" value={proposeContactId} onChange={(e) => setProposeContactId(e.target.value)} placeholder={t('team.calendar.contactIdPlaceholder')} />
        </label>
        <button type="button" className="btn btn-primary" onClick={proposeAppointment} style={{ marginLeft: 8 }}>{t('team.calendar.proposeClosingCta')}</button>
        {appointmentMessage && <p role="status" aria-live="polite" style={{ color: 'var(--muted)' }}>{appointmentMessage}</p>}
      </section>
    </div>
  );
}
