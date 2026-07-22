// T-57 RG6 (i18n; master-spec §17.5, uiux §6.2) — the `/team/*` display-mappers
// (`src/lib/i18n/team-token-display.ts`) closing 6 `RENDERED_I18N_LEAK_BASELINE.json` entries:
// `team/calendar/page.tsx`'s `e.type`/`a.status`/`c.status`, `team/cockpit/page.tsx`'s `s.status`,
// `team/rep/[userId]/components/RepDataPanels.tsx`'s `n.pipelineStage`/`stage`. Proves every known
// enum value resolves to a genuinely distinct EN/ES string, and an unknown/future token falls back
// to a generic, always-localized label — never the raw or merely de-snake-cased token.

import { t } from '@/lib/i18n/catalog';
import {
  eventTypeLabel,
  agendaStatusLabel,
  pipelineStageLabel,
  enterpriseSeatStatusLabel,
} from '@/lib/i18n/team-token-display';

const translateEn = (key: string, vars?: Record<string, string | number>) => t('en', key, vars);
const translateEs = (key: string, vars?: Record<string, string | number>) => t('es', key, vars);

describe('eventTypeLabel — BroadcastEvent.type (team/calendar/page.tsx)', () => {
  test.each(['opportunity_night', 'training', 'team_call', 'big_event'])(
    'TEETH — %s resolves to a real, distinct EN/ES label, never the de-snake-cased raw token',
    (type) => {
      const en = eventTypeLabel(translateEn, type);
      const es = eventTypeLabel(translateEs, type);
      expect(en).not.toBe(type.replace(/_/g, ' '));
      expect(en).not.toBe(es);
    }
  );

  test('reuses the SAME team.calendar.eventType.* keys the <select> in this file already ships', () => {
    expect(eventTypeLabel(translateEn, 'opportunity_night')).toBe('Opportunity night');
    expect(eventTypeLabel(translateEs, 'opportunity_night')).toBe('Noche de oportunidad');
    expect(eventTypeLabel(translateEn, 'big_event')).toBe('Big event');
    expect(eventTypeLabel(translateEs, 'big_event')).toBe('Gran evento');
  });

  test('an unrecognized/future type falls back to a generic localized "Team event" label', () => {
    expect(eventTypeLabel(translateEn, 'surprise_potluck')).toBe('Team event');
    expect(eventTypeLabel(translateEs, 'surprise_potluck')).toBe('Evento de equipo');
  });
});

describe('agendaStatusLabel — Appointment.status / CoachingSession.status (team/calendar/page.tsx)', () => {
  test.each(['PROPOSED', 'CONFIRMED', 'RESCHEDULED', 'DECLINED', 'HELD', 'NO_SHOW', 'CANCELLED', 'COMPLETED'])(
    'TEETH — %s resolves to a real, distinct EN/ES label, never the raw token',
    (status) => {
      const en = agendaStatusLabel(translateEn, status);
      const es = agendaStatusLabel(translateEs, status);
      expect(en).not.toBe(status);
      expect(es).not.toBe(status);
      expect(en).not.toBe(es);
    }
  );

  test('covers BOTH the Appointment-only (RESCHEDULED, HELD) and CoachingSession-only (CANCELLED, COMPLETED) values', () => {
    expect(agendaStatusLabel(translateEn, 'RESCHEDULED')).toBe('Rescheduled');
    expect(agendaStatusLabel(translateEn, 'HELD')).toBe('Held');
    expect(agendaStatusLabel(translateEn, 'CANCELLED')).toBe('Cancelled');
    expect(agendaStatusLabel(translateEn, 'COMPLETED')).toBe('Completed');
    expect(agendaStatusLabel(translateEs, 'CANCELLED')).toBe('Cancelada');
  });

  test('null/undefined/unrecognized all resolve to the generic localized fallback', () => {
    expect(agendaStatusLabel(translateEn, null)).toBe('Status pending');
    expect(agendaStatusLabel(translateEn, 'SOME_FUTURE_STATE')).toBe('Status pending');
    expect(agendaStatusLabel(translateEs, undefined)).toBe('Estado pendiente');
  });
});

describe('pipelineStageLabel — PipelineStage (RepDataPanels.tsx)', () => {
  test.each([
    'IDENTIFIED', 'INTRODUCED', 'RESPONDED', 'APPOINTMENT_PROPOSED', 'APPOINTMENT_CONFIRMED',
    'MET', 'CLOSED_CLIENT', 'CLOSED_RECRUIT', 'DORMANT', 'DO_NOT_CONTACT',
  ])('TEETH — %s resolves to a real, distinct EN/ES label, never the de-snake-cased raw token', (stage) => {
    const en = pipelineStageLabel(translateEn, stage);
    const es = pipelineStageLabel(translateEs, stage);
    expect(en).not.toBe(stage.toLowerCase().replace(/_/g, ' '));
    expect(es).not.toBe(stage.toLowerCase().replace(/_/g, ' '));
    expect(en).not.toBe(es);
  });

  test('CLOSED_RECRUIT — doctrine fix: the label says "teammate", never the forbidden word "recruit"/"reclut"', () => {
    const en = pipelineStageLabel(translateEn, 'CLOSED_RECRUIT');
    const es = pipelineStageLabel(translateEs, 'CLOSED_RECRUIT');
    expect(en.toLowerCase()).not.toContain('recruit');
    expect(es.toLowerCase()).not.toContain('reclut');
    expect(en).toBe('Closed — new teammate');
    expect(es).toBe('Cerrado — nuevo compañero de equipo');
  });

  test('an unrecognized/future stage falls back to a generic localized label', () => {
    expect(pipelineStageLabel(translateEn, 'SOME_FUTURE_STAGE')).toBe('In the pipeline');
    expect(pipelineStageLabel(translateEs, 'SOME_FUTURE_STAGE')).toBe('En el pipeline');
  });
});

describe('enterpriseSeatStatusLabel — EnterpriseSeatAssignment.status (team/cockpit/page.tsx)', () => {
  test('ACTIVE / REVOKED resolve to real, distinct EN/ES labels', () => {
    expect(enterpriseSeatStatusLabel(translateEn, 'ACTIVE')).toBe('Active');
    expect(enterpriseSeatStatusLabel(translateEs, 'ACTIVE')).toBe('Activo');
    expect(enterpriseSeatStatusLabel(translateEn, 'REVOKED')).toBe('Revoked');
    expect(enterpriseSeatStatusLabel(translateEs, 'REVOKED')).toBe('Revocado');
  });

  test('an unrecognized/future status falls back to a generic localized label', () => {
    expect(enterpriseSeatStatusLabel(translateEn, 'SUSPENDED')).toBe('Status');
    expect(enterpriseSeatStatusLabel(translateEs, 'SUSPENDED')).toBe('Estado');
  });
});
