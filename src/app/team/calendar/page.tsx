// T-45 (WP09 §14.1/§14.4; uiux §5.9 item 5, AC-5.9-7) — the team calendar: the RVP-editable master
// calendar (read-only for reps, per §14.4) plus the caller's own merged personal agenda and
// Google/CalDAV connection status.

'use client';

import { useCallback, useEffect, useState } from 'react';

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
}

interface LinkStatus {
  provider: string;
  status: string;
}

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: CalendarData } | { kind: 'failed' };

export default function TeamCalendarPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [links, setLinks] = useState<LinkStatus[]>([]);
  const [canCreate, setCanCreate] = useState(false);

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

  if (state.kind === 'loading') return <div className="card panel"><p>Loading the team calendar…</p></div>;
  if (state.kind === 'failed') {
    return (
      <div className="card panel">
        <p>We couldn&apos;t reach the team calendar right now — your data is safe.</p>
        <button type="button" className="btn btn-secondary" onClick={load}>Retry</button>
      </div>
    );
  }

  const { data } = state;
  const googleLink = links.find((l) => l.provider === 'google');
  const caldavLink = links.find((l) => l.provider === 'caldav_ios');

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">Calendar connections</span>
        <div className="stack" style={{ marginTop: 12 }}>
          <div>
            Google Calendar: <strong>{googleLink?.status ?? 'Not connected'}</strong>
            {googleLink?.status === 'EXPIRED' && <span> — calendar disconnected; we&apos;ll propose times but won&apos;t book blind.</span>}
            {googleLink && <button type="button" className="btn btn-secondary" onClick={() => disconnect('google')} style={{ marginLeft: 8 }}>Disconnect</button>}
          </div>
          <div>
            iOS CalDAV (read-only): <strong>{caldavLink?.status ?? 'Not connected'}</strong>
            {caldavLink && <button type="button" className="btn btn-secondary" onClick={() => disconnect('caldav_ios')} style={{ marginLeft: 8 }}>Disconnect</button>}
          </div>
        </div>
      </section>

      <section className="card panel">
        <span className="badge">Team broadcast calendar</span>
        <p>Opportunity nights, training, and team calls — read-only unless you&apos;re the RVP.</p>
        <ul>
          {data.broadcastEvents.map((e) => (
            <li key={e.id}>
              {e.type.replace(/_/g, ' ')} — {new Date(e.starts_at).toLocaleString()} — your attendance: {e.myAttendanceState}
            </li>
          ))}
          {data.broadcastEvents.length === 0 && <li>No upcoming team events yet.</li>}
        </ul>
        <form
          onSubmit={createEvent}
          className="stack"
          style={{ marginTop: 12 }}
        >
          <label>
            Event type{' '}
            <select name="type" defaultValue="team_call">
              <option value="opportunity_night">Opportunity night</option>
              <option value="training">Training</option>
              <option value="team_call">Team call</option>
              <option value="big_event">Big event</option>
            </select>
          </label>
          <label>
            Starts at <input type="datetime-local" name="startsAt" required />
          </label>
          <button type="submit" className="btn btn-primary">Add to team calendar (RVP only)</button>
          {!canCreate && <p style={{ color: 'var(--muted)' }}>Only the RVP/admin can add to the team calendar.</p>}
        </form>
      </section>

      <section className="card panel">
        <span className="badge">Your agenda</span>
        <ul>
          {data.personalAgenda.appointments.map((a) => (
            <li key={a.id}>Closing appointment — {a.status} — {a.startsAt ? new Date(a.startsAt).toLocaleString() : 'proposed'}</li>
          ))}
          {data.personalAgenda.coachingSessions.map((c) => (
            <li key={c.id}>Coaching session — {c.status} — {c.startsAt ? new Date(c.startsAt).toLocaleString() : 'proposed'}</li>
          ))}
          {data.personalAgenda.appointments.length === 0 && data.personalAgenda.coachingSessions.length === 0 && <li>Nothing on your calendar in the next 30 days.</li>}
        </ul>
      </section>
    </div>
  );
}
