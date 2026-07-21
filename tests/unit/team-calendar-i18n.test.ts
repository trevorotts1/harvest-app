// T-R32c (i18n completion, master-spec §17.5; uiux §6.2) — the Team Calendar page
// (`src/app/team/calendar/page.tsx`) carried 33 pre-existing `NO_LITERALS_BASELINE.json`
// entries — the single largest count of any file in this build. Proves the full retrofit: EN
// default unchanged, genuine ES render (not a silent EN fallback).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TeamCalendarPage from '@/app/team/calendar/page';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const renderEn = () => renderToStaticMarkup(createElement(TeamCalendarPage));

const renderEs = () =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(TeamCalendarPage)
    )
  );

describe('Team Calendar page — i18n (EN default + genuine ES render, T-R32c)', () => {
  test('EN default renders the loading narrative in English', () => {
    expect(textOf(renderEn())).toContain('Loading the team calendar…');
  });

  test('ES provider renders the loading narrative genuinely in Spanish — not a silent EN fallback', () => {
    const text = textOf(renderEs());
    expect(text).toContain('Cargando el calendario del equipo…');
    expect(text).not.toContain('Loading the team calendar');
  });

  test('the connection/broadcast/agenda section catalog keys resolve to real, distinct EN/ES copy', () => {
    expect(t('en', 'team.calendar.connectionsBadge')).toBe('Calendar connections');
    expect(t('es', 'team.calendar.connectionsBadge')).toBe('Conexiones de calendario');
    expect(t('en', 'team.calendar.broadcastBadge')).toBe('Team broadcast calendar');
    expect(t('es', 'team.calendar.broadcastBadge')).toBe('Calendario de difusión del equipo');
    expect(t('en', 'team.calendar.agendaBadge')).toBe('Your agenda');
    expect(t('es', 'team.calendar.agendaBadge')).toBe('Tu agenda');
    expect(t('en', 'team.calendar.eventType.opportunityNight')).toBe('Opportunity night');
    expect(t('es', 'team.calendar.eventType.opportunityNight')).toBe('Noche de oportunidad');
  });

  test('the propose-coaching/propose-closing status-message catalog keys (scanner blind spots — imperative setState literals) resolve to real, distinct EN/ES copy', () => {
    expect(t('en', 'team.calendar.noUplineOnFile')).toBe("You don't have an upline on file yet.");
    expect(t('es', 'team.calendar.noUplineOnFile')).toBe('Todavía no tienes un upline registrado.');
    expect(t('en', 'team.calendar.appointmentBookedNotice')).toBe('Booked — a confirmation draft is in your Approval Inbox.');
    expect(t('es', 'team.calendar.appointmentBookedNotice')).toBe(
      'Reservada — un borrador de confirmación está en tu Bandeja de aprobación.'
    );
  });

  test('the RVP-only add-to-calendar copy and closing-appointment CTA are real, distinct EN/ES catalog entries', () => {
    expect(t('en', 'team.calendar.addEventCta')).toBe('Add to team calendar (RVP only)');
    expect(t('es', 'team.calendar.addEventCta')).toBe('Agregar al calendario del equipo (solo RVP)');
    expect(t('en', 'team.calendar.proposeClosingCta')).toBe('Propose closing appointment');
    expect(t('es', 'team.calendar.proposeClosingCta')).toBe('Proponer cita de cierre');
  });
});
