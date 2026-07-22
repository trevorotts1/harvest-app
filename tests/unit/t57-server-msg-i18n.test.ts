// T-57 server-msg-i18n — closes the last flavor of the i18n leak class RG4-hardening flagged:
// server-COMPOSED English prose rendered to the rep on the Today screen. The 6 Today zone
// components render `result.message` (today.service.ts's `safeZone`) and each zone's own
// server-composed strings (Action Queue `title`/`why`, Pipeline bucket `label`, Ratio `explainer`/
// `labels`, the Grove `caption`/`bloomNarration`, the Milestones pin-strip `label`) — all of which
// were bare English literals regardless of the rep's real `User.locale`, unlike `briefing.ts` (fixed
// by T-57 R4-residual2, the reference pattern this fix mirrors).
//
// Every zone builder below keeps its EXISTING no-locale-argument call byte-identical to English (no
// regression for any pre-existing caller/test), and gains a genuine, idiomatic Spanish render when a
// `Locale` is resolved — either via an explicit param or (at the `buildMissionControlToday`
// aggregator level) a duck-typed `db.user.findUnique` lookup, exactly like `briefing.ts`'s own
// `resolveRepLocale`.

import { buildMissionControlToday } from '@/services/mission-control/today.service';
import { buildActionQueueZone } from '@/services/mission-control/zones/action-queue';
import { buildPipelineZone } from '@/services/mission-control/zones/pipeline';
import { buildRatiosZone } from '@/services/mission-control/zones/ratios';
import { buildMilestonesZone } from '@/services/mission-control/zones/milestones';
import { createInMemoryMissionControlDb } from '@/services/mission-control/testing/in-memory-db';

const USER = 'rep-1';
const ORG = 'org-1';
const NOW = new Date('2026-07-15T12:00:00.000Z');

describe('Action Queue zone (action-queue.ts) — title/why now locale-aware', () => {
  function seed(cfeOutcome: string, approvalState: string) {
    return createInMemoryMissionControlDb({
      draftMessages: [
        {
          id: 'draft-1',
          user_id: USER,
          contact_id: 'contact-1',
          channel: 'SMS_HANDOFF',
          cfe_outcome: cfeOutcome,
          approval_state: approvalState,
          approved_by: null,
          approved_at: null,
          created_at: NOW,
        },
      ],
      contacts: [{ id: 'contact-1', user_id: USER, first_name: 'Maya', last_name: 'Johnson', pipeline_stage: 'INTRODUCED', is_client: false, updated_at: NOW, created_at: NOW }],
      appointments: [{ id: 'appt-1', rep_id: USER, contact_id: 'contact-1', status: 'PROPOSED', confirmed_start: null, created_at: NOW }],
    });
  }

  test('EN default (no locale arg): approve_draft title/why unchanged', async () => {
    const db = seed('PASS', 'PENDING');
    const zone = await buildActionQueueZone(db, USER);
    const item = zone.items.find((i) => i.kind === 'approve_draft');
    expect(item?.title).toBe('Approve draft');
    expect(item?.why).toBe('Your agent drafted this community introduction — approve to hand it off.');
  });

  test('EN default: review_flagged title/why unchanged', async () => {
    const db = seed('FLAG', 'PENDING');
    const zone = await buildActionQueueZone(db, USER);
    const item = zone.items.find((i) => i.kind === 'review_flagged');
    expect(item?.title).toBe('Review flagged draft');
    expect(item?.why).toBe('This draft needs your review before it can send.');
  });

  test('EN default: confirm_appointment title/why unchanged', async () => {
    const db = seed('PASS', 'PENDING');
    const zone = await buildActionQueueZone(db, USER);
    const item = zone.items.find((i) => i.kind === 'confirm_appointment');
    expect(item?.title).toBe('Confirm appointment window');
    expect(item?.why).toBe('A proposed appointment time is waiting for your confirmation.');
  });

  test('TEETH — es locale: genuine Spanish title/why for all three kinds, never English', async () => {
    const db = seed('FLAG', 'PENDING');
    const zone = await buildActionQueueZone(db, USER, 'es');
    const flagged = zone.items.find((i) => i.kind === 'review_flagged');
    const confirm = zone.items.find((i) => i.kind === 'confirm_appointment');
    expect(flagged?.title).toBe('Revisar borrador marcado');
    expect(flagged?.why).toBe('Este borrador necesita tu revisión antes de poder enviarse.');
    expect(confirm?.title).toBe('Confirmar horario de la cita');
    expect(confirm?.why).toBe('Hay un horario de cita propuesto esperando tu confirmación.');
    expect(flagged?.title).not.toContain('Review');
    expect(confirm?.why).not.toContain('waiting');
  });

  test('es locale: approve_draft title/why', async () => {
    const db = seed('PASS', 'PENDING');
    const zone = await buildActionQueueZone(db, USER, 'es');
    const item = zone.items.find((i) => i.kind === 'approve_draft');
    expect(item?.title).toBe('Aprobar borrador');
    expect(item?.why).toBe('Tu agente redactó esta introducción comunitaria — apruébala para enviarla.');
  });
});

describe('Pipeline zone (pipeline.ts) — bucket labels now locale-aware', () => {
  const db = createInMemoryMissionControlDb({
    contacts: [
      { id: 'c1', user_id: USER, first_name: 'A', last_name: 'B', pipeline_stage: 'INTRODUCED', is_client: false, updated_at: NOW, created_at: NOW },
      { id: 'c2', user_id: USER, first_name: 'C', last_name: 'D', pipeline_stage: 'RESPONDED', is_client: false, updated_at: NOW, created_at: NOW },
    ],
  });

  test('EN default: bucket labels unchanged', async () => {
    const zone = await buildPipelineZone(db, USER, NOW);
    const labels = zone.buckets.map((b) => b.label);
    expect(labels).toEqual(['Introduced', 'Responded', 'Appointment', 'Closed']);
  });

  test('TEETH — es locale: genuine Spanish bucket labels', async () => {
    const zone = await buildPipelineZone(db, USER, NOW, 'es');
    const labels = zone.buckets.map((b) => b.label);
    expect(labels).toEqual(['Presentado', 'Respondió', 'Cita', 'Cerrado']);
    expect(labels).not.toContain('Introduced');
  });
});

describe('Ratios zone (ratios.ts) — explainer + labels now locale-aware, with real CLDR plural', () => {
  function seedBelowThreshold() {
    return createInMemoryMissionControlDb({
      draftMessages: [{ id: 'd1', user_id: USER, contact_id: 'c1', channel: 'SMS_HANDOFF', cfe_outcome: 'PASS', approval_state: 'APPROVED', approved_by: USER, approved_at: NOW, created_at: NOW }],
      contacts: [{ id: 'c1', user_id: USER, first_name: 'A', last_name: 'B', pipeline_stage: 'INTRODUCED', is_client: false, updated_at: NOW, created_at: NOW }],
    });
  }

  test('EN default, below learning threshold: baseline explainer + labels unchanged', async () => {
    const db = seedBelowThreshold();
    const zone = await buildRatiosZone(db, USER);
    expect(zone.agentRatio.learning).toBe(true);
    expect(zone.agentRatio.labels).toEqual(['Introductions', 'Appointments set', 'Confirmed shows']);
    expect(zone.agentRatio.explainer).toContain("Your Agent's Ratio measures how effective your AI agents are");
    expect(zone.fieldTrainerRatio.labels).toEqual(['Appointments run', 'Client signs', 'Teammates brought in']);
  });

  test('TEETH — es locale, below threshold: genuine Spanish baseline explainer + labels', async () => {
    const db = seedBelowThreshold();
    const zone = await buildRatiosZone(db, USER, 'es');
    expect(zone.agentRatio.labels).toEqual(['Introducciones', 'Citas agendadas', 'Asistencias confirmadas']);
    expect(zone.agentRatio.explainer).toContain('La Proporción de tu Agente mide qué tan efectivos son tus agentes de IA');
    expect(zone.fieldTrainerRatio.labels).toEqual(['Citas realizadas', 'Clientes firmados', 'Compañeros de equipo incorporados']);
    expect(zone.agentRatio.explainer).not.toContain('Your Agent');
  });

  // Real-data (>= RATIO_LEARNING_THRESHOLD) branch — exercises the CLDR-plural explainer functions.
  function seedRealData(introductions: number, appointmentsSet: number, confirmedShows: number) {
    const draftMessages = Array.from({ length: introductions }, (_, i) => ({
      id: `d${i}`, user_id: USER, contact_id: 'c1', channel: 'SMS_HANDOFF', cfe_outcome: 'PASS' as const,
      approval_state: 'APPROVED' as const, approved_by: USER, approved_at: NOW, created_at: NOW,
    }));
    const appointments = Array.from({ length: appointmentsSet }, (_, i) => ({
      id: `a${i}`, rep_id: USER, contact_id: 'c1', status: i < confirmedShows ? 'CONFIRMED' : 'PROPOSED', confirmed_start: null, created_at: NOW,
    }));
    return createInMemoryMissionControlDb({
      draftMessages,
      appointments,
      contacts: [{ id: 'c1', user_id: USER, first_name: 'A', last_name: 'B', pipeline_stage: 'INTRODUCED', is_client: false, updated_at: NOW, created_at: NOW }],
    });
  }

  test('EN, real-data, plural counts: "introductions"/"appointments set"/"confirmed shows"', async () => {
    const db = seedRealData(25, 6, 2);
    const zone = await buildRatiosZone(db, USER);
    expect(zone.agentRatio.learning).toBe(false);
    expect(zone.agentRatio.explainer).toBe(
      'Your own record: 25 introductions -> 6 appointments set -> 2 confirmed shows. This is how effective your AI agents are for your community.'
    );
  });

  test('EN, real-data, singular counts (all 1 above a padded intro count): CLDR "one" category renders correct singular nouns', async () => {
    // introductions must clear RATIO_LEARNING_THRESHOLD (20) to leave the baseline branch; the
    // appointment-set/confirmed-shows counts are independently exercised at exactly 1.
    const db = seedRealData(20, 1, 1);
    const zone = await buildRatiosZone(db, USER);
    expect(zone.agentRatio.explainer).toBe(
      'Your own record: 20 introductions -> 1 appointment set -> 1 confirmed show. This is how effective your AI agents are for your community.'
    );
  });

  test('TEETH — es locale, real-data, plural counts: genuine Spanish with correct plural nouns', async () => {
    const db = seedRealData(25, 6, 2);
    const zone = await buildRatiosZone(db, USER, 'es');
    expect(zone.agentRatio.explainer).toBe(
      'Tu propio historial: 25 introducciones -> 6 citas agendadas -> 2 asistencias confirmadas. Así de efectivos son tus agentes de IA para tu comunidad.'
    );
  });

  test('TEETH — es locale, real-data, singular counts: CLDR "one" category renders correct Spanish singular nouns, never "s"-suffixed plurals', async () => {
    const db = seedRealData(20, 1, 1);
    const zone = await buildRatiosZone(db, USER, 'es');
    expect(zone.agentRatio.explainer).toBe(
      'Tu propio historial: 20 introducciones -> 1 cita agendada -> 1 asistencia confirmada. Así de efectivos son tus agentes de IA para tu comunidad.'
    );
    expect(zone.agentRatio.explainer).not.toContain('citas agendadas -> 1');
  });

  test('Field Trainer ratio: EN + es real-data explainer, CLDR plural on all three counts', async () => {
    const db = createInMemoryMissionControlDb({
      contacts: Array.from({ length: 25 }, (_, i) => ({
        id: `c${i}`, user_id: USER, first_name: 'A', last_name: 'B',
        pipeline_stage: i < 8 ? 'MET' : i < 20 ? 'CLOSED_CLIENT' : 'INTRODUCED',
        is_client: i >= 8 && i < 20, updated_at: NOW, created_at: NOW,
      })).concat([{ id: 'recruit-1', user_id: USER, first_name: 'R', last_name: 'J', pipeline_stage: 'CLOSED_RECRUIT', is_client: false, updated_at: NOW, created_at: NOW }]),
    });
    const en = await buildRatiosZone(db, USER);
    expect(en.fieldTrainerRatio.learning).toBe(false);
    expect(en.fieldTrainerRatio.explainer).toBe('Your trainer\'s own record: of 21 appointments run, 12 became clients and 1 joined as a teammate.');

    const es = await buildRatiosZone(db, USER, 'es');
    expect(es.fieldTrainerRatio.explainer).toBe('El historial de tu entrenador: de 21 citas realizadas, 12 se convirtieron en clientes y 1 se unió como compañero de equipo.');
  });
});

describe('Milestones zone (milestones.ts) — pin-strip label now locale-aware', () => {
  function seed() {
    return createInMemoryMissionControlDb({
      milestones: [{ user_id: USER, milestone_key: 'FIRST_APPOINTMENT', achieved_at: NOW, celebrated: true }],
    });
  }

  test('EN default: label unchanged', async () => {
    const zone = await buildMilestonesZone(seed(), USER);
    expect(zone.items[0]?.label).toBe("You just helped a family in your community get protected — that's why you're here.");
  });

  test('TEETH — es locale: genuine Spanish label', async () => {
    const zone = await buildMilestonesZone(seed(), USER, 'es');
    expect(zone.items[0]?.label).toBe('Acabas de ayudar a una familia de tu comunidad a protegerse — para eso estás aquí.');
  });
});

describe('today.service.ts — safeZone error message + full aggregator locale threading', () => {
  function fullSeed() {
    return createInMemoryMissionControlDb({
      momentumEvents: [{ user_id: USER, law: 'grow', points: 10, created_at: NOW }],
      draftMessages: [{ id: 'd1', user_id: USER, contact_id: 'c1', channel: 'SMS_HANDOFF', cfe_outcome: 'FLAG', approval_state: 'PENDING', approved_by: null, approved_at: null, created_at: NOW }],
      contacts: [{ id: 'c1', user_id: USER, first_name: 'A', last_name: 'B', pipeline_stage: 'INTRODUCED', is_client: false, updated_at: NOW, created_at: NOW }],
      appointments: [{ id: 'a1', rep_id: USER, contact_id: 'c1', status: 'PROPOSED', confirmed_start: null, created_at: NOW }],
      teamEvents: [{ id: 'e1', organization_id: ORG, type: 'team_call', starts_at: new Date(NOW.getTime() + 60 * 60 * 1000) }],
    });
  }

  function breakContact(db: ReturnType<typeof fullSeed>) {
    return { ...db, contact: { findMany: async () => { throw new Error('simulated failure'); } } };
  }

  test('EN default (no locale signal): a broken zone still shows the unchanged English message', async () => {
    const broken = breakContact(fullSeed());
    const today = await buildMissionControlToday(USER, { db: broken, greetingName: 'Alex', organizationId: ORG, now: NOW });
    expect(today.pipeline.status).toBe('error');
    if (today.pipeline.status === 'error') {
      expect(today.pipeline.message).toBe('We could not load this right now — the rest of Today is unaffected.');
    }
  });

  test('TEETH — explicit es locale option: a broken zone shows a genuine Spanish error message, never English', async () => {
    const broken = breakContact(fullSeed());
    const today = await buildMissionControlToday(USER, { db: broken, greetingName: 'Alex', organizationId: ORG, now: NOW, locale: 'es' });
    expect(today.pipeline.status).toBe('error');
    if (today.pipeline.status === 'error') {
      expect(today.pipeline.message).toBe('No pudimos cargar esto ahora mismo — el resto de Hoy no se ve afectado.');
      expect(today.pipeline.message).not.toContain('We could not');
    }
  });

  test('production-realistic path: NO explicit locale passed — resolves off a duck-typed db.user.findUnique, matching briefing.ts\'s own pattern', async () => {
    const broken = breakContact(fullSeed());
    const dbWithEsUser = { ...broken, user: { findUnique: async () => ({ locale: 'es' }) } };
    const today = await buildMissionControlToday(USER, { db: dbWithEsUser, greetingName: 'Alex', organizationId: ORG, now: NOW });
    expect(today.pipeline.status).toBe('error');
    if (today.pipeline.status === 'error') {
      expect(today.pipeline.message).toBe('No pudimos cargar esto ahora mismo — el resto de Hoy no se ve afectado.');
    }
  });

  test('fail-safe: a db.user.findUnique that throws, or an invalid locale, degrades to English — never crashes the whole Today response', async () => {
    const broken = breakContact(fullSeed());
    const dbThrows = { ...broken, user: { findUnique: async () => { throw new Error('simulated DB hiccup'); } } };
    const resultThrows = await buildMissionControlToday(USER, { db: dbThrows, greetingName: 'Alex', organizationId: ORG, now: NOW });
    expect(resultThrows.pipeline.status).toBe('error');
    if (resultThrows.pipeline.status === 'error') {
      expect(resultThrows.pipeline.message).toBe('We could not load this right now — the rest of Today is unaffected.');
    }

    const dbInvalidLocale = { ...broken, user: { findUnique: async () => ({ locale: 'fr' }) } };
    const resultInvalid = await buildMissionControlToday(USER, { db: dbInvalidLocale, greetingName: 'Alex', organizationId: ORG, now: NOW });
    expect(resultInvalid.pipeline.status).toBe('error');
    if (resultInvalid.pipeline.status === 'error') {
      expect(resultInvalid.pipeline.message).toBe('We could not load this right now — the rest of Today is unaffected.');
    }
  });

  test('END-TO-END — es locale threads through EVERY zone: action queue, pipeline, ratios all render genuine Spanish from a single buildMissionControlToday call', async () => {
    const db = fullSeed();
    const today = await buildMissionControlToday(USER, { db, greetingName: 'Alex', organizationId: ORG, now: NOW, locale: 'es' });

    expect(today.actionQueue.status).toBe('ok');
    if (today.actionQueue.status === 'ok') {
      const flagged = today.actionQueue.data.items.find((i) => i.kind === 'review_flagged');
      expect(flagged?.title).toBe('Revisar borrador marcado');
    }

    expect(today.pipeline.status).toBe('ok');
    if (today.pipeline.status === 'ok') {
      expect(today.pipeline.data.buckets.map((b) => b.label)).toContain('Presentado');
    }

    expect(today.ratios.status).toBe('ok');
    if (today.ratios.status === 'ok') {
      expect(today.ratios.data.agentRatio.labels).toEqual(['Introducciones', 'Citas agendadas', 'Asistencias confirmadas']);
    }

    expect(today.header.status).toBe('ok');
    if (today.header.status === 'ok') {
      // No fresh milestone in this seed, so groveState is whatever the band computes to (not bloom) —
      // the caption itself must still be genuine Spanish, not the English default.
      expect(['Floreciendo', 'Creciendo', 'Tu campo está tranquilo — una pequeña acción lo despierta', 'En reposo, listo para volver a crecer', 'Está vivo. Sigue adelante.', 'Tu campo está sembrado — las Primeras 48 comienzan ahora']).toContain(today.header.data.groveCaption);
    }
  });
});
