// T-R47 (Final QC leak fix; master-spec §9.7-§9.8/§17.5, uiux §5.3/§6.2) — the Shift screen's ratio
// explainers (`RatioCardView.explainer`/`.learningLabel`, `learning-state/ratios.ts`) and its
// empty-queue/motivational lines (`briefingLines`/`motivationalLine`, `shift.service.ts`) used to be
// bare English literals with no `locale` threaded and no `t()` call — the Shift screen rendered full
// English paragraphs to Spanish-locale reps while the rest of the screen (and Today's OWN ratio
// cards, `mission-control/zones/ratios.ts`) was correctly translated. Proves the retrofit, mirroring
// `tests/unit/t57-server-msg-i18n.test.ts`'s exact TEETH shape (byte-exact EN unchanged + byte-exact
// genuine ES, never a silent EN fallback) at three layers: (A) the pure `ratios.ts` view builders,
// (B) `LearningStateService.recomputeAndGetView`'s locale resolution (explicit param + the
// duck-typed `db.user.findUnique` production path, exactly like `today.service.ts`'s
// `resolveRepLocale`), (C) `ShiftService`'s own duck-typed resolution feeding `briefingLines`/
// `motivationalLine`, and (D) a genuine COMPONENT render (`RatioCard`/`OpenPhase`) of the real
// locale-produced strings, following `tests/unit/shift-phases-i18n.test.ts`'s render-test precedent.

import { createElement, type ElementType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import RatioCard from '@/app/shift/components/RatioCard';
import OpenPhase from '@/app/shift/components/OpenPhase';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

import {
  buildAgentRatioCardView,
  buildFieldTrainerRatioCardView,
  type AgentRatioTally,
  type FieldTrainerRatioTally,
} from '@/services/learning-state/ratios';
import { LearningStateService, type LearningStatePrismaClient } from '@/services/learning-state/learning-state.service';
import {
  ShiftService,
  type ShiftPrismaClient,
  type ShiftSessionRow,
} from '@/services/learning-state/shift.service';
import type { PipelineStageLike } from '@/services/learning-state/ratios';

const noop = () => {};
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;|&rsquo;/gi, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const renderEn = (el: ElementType, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el, props));
const renderEs = (el: ElementType, props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es' as const, setLocale: noop, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(el, props)
    )
  );

// ─── (A) ratios.ts — pure view builders, byte-exact EN/ES ──────────────────────────────────────────

describe('(A) buildAgentRatioCardView / buildFieldTrainerRatioCardView — locale threading', () => {
  const learningAgentTally: AgentRatioTally = { introductions: 5, responses: 3, appointmentsSet: 1, confirmedShows: 0, dataPointCount: 5 };

  test('EN default (no locale arg): baseline explainer + label unchanged', () => {
    const view = buildAgentRatioCardView(learningAgentTally);
    expect(view.learningLabel).toBe('learning your community');
    expect(view.explainer).toBe(
      "Your Agent's Ratio measures how effective your AI agents are: introductions that get a response, turn into a set appointment, and show up. New reps start on the community baseline (20 introductions to 5 appointments to 1 confirmed show) until your own record builds up."
    );
  });

  test('TEETH — es locale: genuine Spanish baseline explainer + label, never English', () => {
    const view = buildAgentRatioCardView(learningAgentTally, 'es');
    expect(view.learningLabel).toBe('conociendo tu comunidad');
    expect(view.explainer).toBe(
      'La Proporción de tu Agente mide qué tan efectivos son tus agentes de IA: introducciones que obtienen respuesta, se convierten en una cita agendada y se presentan. Los nuevos representantes comienzan con la referencia de la comunidad (20 introducciones por 5 citas por 1 asistencia confirmada) hasta que se acumule tu propio historial.'
    );
    expect(view.explainer).not.toContain("Your Agent's Ratio");
    expect(view.learningLabel).not.toBe('learning your community');
  });

  const realAgentTally: AgentRatioTally = { introductions: 25, responses: 20, appointmentsSet: 6, confirmedShows: 2, dataPointCount: 25 };

  test('EN, real record: exact composed sentence with all four counts (introductions/responded/set/shows)', () => {
    const view = buildAgentRatioCardView(realAgentTally);
    expect(view.explainer).toBe(
      'Your own record: 25 introductions -> 20 responded -> 6 appointments set -> 2 confirmed shows. This is how effective your AI agents are for your community.'
    );
  });

  test('TEETH — es locale, real record: genuine Spanish, correct CLDR plurals on every count', () => {
    const view = buildAgentRatioCardView(realAgentTally, 'es');
    expect(view.explainer).toBe(
      'Tu propio historial: 25 introducciones -> 20 respondieron -> 6 citas agendadas -> 2 asistencias confirmadas. Así de efectivos son tus agentes de IA para tu comunidad.'
    );
  });

  const realAgentTallySingular: AgentRatioTally = { introductions: 20, responses: 1, appointmentsSet: 1, confirmedShows: 1, dataPointCount: 20 };

  test('TEETH — es locale, singular counts: CLDR "one" category everywhere, never "s"-suffixed plurals', () => {
    const view = buildAgentRatioCardView(realAgentTallySingular, 'es');
    expect(view.explainer).toBe(
      'Tu propio historial: 20 introducciones -> 1 respondió -> 1 cita agendada -> 1 asistencia confirmada. Así de efectivos son tus agentes de IA para tu comunidad.'
    );
    expect(view.explainer).not.toContain('citas agendadas -> 1');
  });

  const learningTrainerTally: FieldTrainerRatioTally = { appointmentsRun: 3, closes: 1, dataPointCount: 3 };

  test("EN default: trainer baseline explainer unchanged (Shift's OWN 5:1 baseline, not Today's 20:5:1)", () => {
    const view = buildFieldTrainerRatioCardView(learningTrainerTally);
    expect(view.explainer).toBe(
      "Your Field Trainer's Ratio measures your trainer's close rate once they run the appointment: how many become a client or a new teammate. New reps start on the community baseline (5 appointments to 1 close) until enough of your own appointments have run."
    );
  });

  test('TEETH — es locale: genuine Spanish trainer baseline explainer, distinct from Today\'s 20:5:1 key', () => {
    const view = buildFieldTrainerRatioCardView(learningTrainerTally, 'es');
    expect(view.explainer).toBe(
      'La Proporción de tu Entrenador de Campo mide la tasa de cierre de tu entrenador una vez que realiza la cita: cuántas se convierten en un cliente o en un nuevo compañero de equipo. Los nuevos representantes comienzan con la referencia de la comunidad (5 citas por 1 cierre) hasta que se hayan realizado suficientes citas propias.'
    );
    expect(view.explainer).not.toContain('Field Trainer');
    expect(view.explainer).not.toContain('20 citas realizadas'); // never Today's 3-number baseline text
  });

  const realTrainerTally: FieldTrainerRatioTally = { appointmentsRun: 25, closes: 3, dataPointCount: 25 };

  test('EN, real record: exact composed sentence', () => {
    const view = buildFieldTrainerRatioCardView(realTrainerTally);
    expect(view.explainer).toBe("Your trainer's own record: 3 out of 25 appointments run became a client or a new teammate.");
  });

  test('TEETH — es locale, real record: genuine Spanish, correct plural subject-verb agreement on closes', () => {
    const view = buildFieldTrainerRatioCardView(realTrainerTally, 'es');
    expect(view.explainer).toBe(
      'El historial de tu entrenador: 3 de 25 citas realizadas se convirtieron en cliente o en un nuevo compañero de equipo.'
    );
  });

  // appointmentsRun IS the tally's dataPointCount (computeFieldTrainerRatio always sets them equal),
  // so — same technique tests/unit/t57-server-msg-i18n.test.ts's own `seedRealData(20, 1, 1)` uses —
  // this fixture is hand-built (not routed through `computeFieldTrainerRatio`) to independently
  // exercise the singular "one appointment run" / singular "se convirtió" CLDR forms while still
  // landing in the real (non-baseline) branch.
  const realTrainerTallySingular: FieldTrainerRatioTally = { appointmentsRun: 1, closes: 1, dataPointCount: 20 };

  test('TEETH — es locale, singular counts: CLDR "one" category on both the run-count and the closes verb', () => {
    const view = buildFieldTrainerRatioCardView(realTrainerTallySingular, 'es');
    expect(view.explainer).toBe(
      'El historial de tu entrenador: 1 de 1 cita realizada se convirtió en cliente o en un nuevo compañero de equipo.'
    );
    expect(view.explainer).not.toContain('citas realizadas');
    expect(view.explainer).not.toContain('convirtieron');
  });
});

// ─── (B) LearningStateService.recomputeAndGetView — locale resolution ──────────────────────────────

describe('(B) LearningStateService.recomputeAndGetView — locale threading', () => {
  function makeFakePrisma(opts: {
    contacts?: { id: string; user_id: string; pipeline_stage: string }[];
    userLocale?: string | null;
    withUserAccessor?: boolean;
  }): LearningStatePrismaClient {
    const contacts = opts.contacts ?? [];
    const base: LearningStatePrismaClient = {
      contact: {
        async findMany({ where }) {
          return contacts.filter((c) => c.user_id === where.user_id).map((c) => ({ id: c.id, pipeline_stage: c.pipeline_stage as PipelineStageLike }));
        },
      },
      appointment: {
        async findMany() {
          return [];
        },
      },
      learningState: {
        async upsert({ create }) {
          return {
            user_id: create.user_id as string,
            status: create.status as string,
            agent_introductions: create.agent_introductions as number,
            agent_responses: create.agent_responses as number,
            agent_appointments_set: create.agent_appointments_set as number,
            agent_confirmed_shows: create.agent_confirmed_shows as number,
            trainer_appointments_run: create.trainer_appointments_run as number,
            trainer_closes: create.trainer_closes as number,
            computed_at: new Date('2026-07-18T12:00:00Z'),
          };
        },
      },
    };
    if (!opts.withUserAccessor) return base;
    // T-R47 — the duck-typed `.user` accessor `resolveRepLocale` (learning-state.service.ts) looks
    // for; a real Prisma client always has this even though `LearningStatePrismaClient` (this file's
    // narrow DI interface) declares no such field. Returned via a widely-typed intermediate variable
    // (not a fresh literal) so TS's excess-property check on `findUnique`'s narrower declared return
    // type never fires — the SAME reason the real Prisma client's own untyped extra columns compile
    // fine at this call site.
    return {
      ...base,
      user: {
        async findUnique() {
          const row: { locale: string | null } = { locale: opts.userLocale ?? null };
          return row;
        },
      },
    } as unknown as LearningStatePrismaClient;
  }

  test('explicit `es` locale param: genuine Spanish explainer + label', async () => {
    const prisma = makeFakePrisma({ contacts: [{ id: 'c1', user_id: 'rep-1', pipeline_stage: 'INTRODUCED' }] });
    const service = new LearningStateService(prisma);
    const view = await service.recomputeAndGetView('rep-1', 'es');
    expect(view.agentRatio.learningLabel).toBe('conociendo tu comunidad');
    expect(view.agentRatio.explainer).toContain('La Proporción de tu Agente');
    expect(view.agentRatio.explainer).not.toContain("Your Agent's Ratio");
  });

  test('production-realistic path — NO explicit locale passed: resolves off a duck-typed db.user.findUnique, matching today.service.ts\'s own pattern', async () => {
    const prisma = makeFakePrisma({
      contacts: [{ id: 'c1', user_id: 'rep-1', pipeline_stage: 'INTRODUCED' }],
      userLocale: 'es',
      withUserAccessor: true,
    });
    const service = new LearningStateService(prisma);
    const view = await service.recomputeAndGetView('rep-1');
    expect(view.agentRatio.explainer).toContain('La Proporción de tu Agente');
  });

  test('a db.user-less fake (every pre-existing test fixture in this codebase) safely falls through to English, never throws', async () => {
    const prisma = makeFakePrisma({ contacts: [{ id: 'c1', user_id: 'rep-1', pipeline_stage: 'INTRODUCED' }] });
    const service = new LearningStateService(prisma);
    const view = await service.recomputeAndGetView('rep-1');
    expect(view.agentRatio.explainer).toContain("Your Agent's Ratio measures");
  });
});

// ─── (C) ShiftService.toView (via getOrCreateToday) — briefingLines/motivationalLine locale threading

describe('(C) ShiftService — Open-phase briefingLines/motivationalLine locale threading', () => {
  function makeFakePrisma(opts: { userLocale?: string | null; sessions?: ShiftSessionRow[] }): ShiftPrismaClient {
    const sessions = new Map<string, ShiftSessionRow>((opts.sessions ?? []).map((s) => [`${s.user_id}::${s.session_date}`, s]));
    let idCounter = 0;
    const prisma: ShiftPrismaClient = {
      shiftSession: {
        async findUnique({ where }) {
          return sessions.get(`${where.user_id_session_date.user_id}::${where.user_id_session_date.session_date}`) ?? null;
        },
        async findMany() {
          return [];
        },
        async create({ data }) {
          idCounter += 1;
          const row: ShiftSessionRow = {
            id: `sess-${idCounter}`,
            user_id: 'rep-1',
            session_date: '2026-07-18',
            mode: 'STANDARD',
            phase: 'OPEN',
            stack_position: 0,
            skip_counts: {},
            accumulated_seconds: 0,
            last_resumed_at: null,
            streak_count: 0,
            grace_day_used: false,
            reflection_text: null,
            recap_approvals: 0,
            recap_confirmations: 0,
            recap_logs: 0,
            completed_at: null,
            ...(data as Partial<ShiftSessionRow>),
          };
          sessions.set(`${row.user_id}::${row.session_date}`, row);
          return row;
        },
        async update({ where, data }) {
          const existing = Array.from(sessions.values()).find((s) => s.id === where.id);
          if (!existing) throw new Error('not found');
          const updated = { ...existing, ...(data as Partial<ShiftSessionRow>) };
          sessions.set(`${updated.user_id}::${updated.session_date}`, updated);
          return updated;
        },
      },
      draftMessage: {
        async findMany() {
          return [];
        },
        async findUnique() {
          return null;
        },
        async update() {
          throw new Error('not used');
        },
      },
      appointment: {
        async findMany() {
          return [];
        },
        async findUnique() {
          return null;
        },
        async update() {
          throw new Error('not used');
        },
      },
      user: {
        // T-R47 — same duck-typed shape as (B) above: a real full-row Prisma find (this narrow DI
        // type only names `intensity_setting`) really does carry `.locale`; returned via a widely-
        // typed intermediate variable so the extra field never trips an excess-property check.
        async findUnique() {
          const row: { intensity_setting: string; locale: string | null } = { intensity_setting: 'MEDIUM', locale: opts.userLocale ?? null };
          return row;
        },
      },
      contact: {
        async findMany() {
          return [];
        },
      },
      momentumEvent: {
        async create() {
          return { id: 'mom-1' };
        },
      },
    };
    return prisma;
  }

  test('EN default (no User.locale set): empty-queue + motivational lines unchanged', async () => {
    const service = new ShiftService(makeFakePrisma({}));
    const view = await service.getOrCreateToday('rep-1');
    expect(view.isEmpty).toBe(true);
    expect(view.briefingLines).toEqual(['Nothing needs you today — your field is working.']);
    expect(view.motivationalLine).toBe('Small, steady attention compounds. Show up — that is the whole job today.');
  });

  test('TEETH — es User.locale, empty queue: genuine Spanish empty-queue + motivational lines', async () => {
    const service = new ShiftService(makeFakePrisma({ userLocale: 'es' }));
    const view = await service.getOrCreateToday('rep-1');
    expect(view.briefingLines).toEqual(['Nada necesita de ti hoy — tu campo está trabajando.']);
    expect(view.motivationalLine).toBe('La atención pequeña y constante se acumula. Preséntate — eso es todo el trabajo de hoy.');
    expect(view.briefingLines[0]).not.toContain('Nothing');
    expect(view.motivationalLine).not.toContain('Small');
  });
});

// ─── (D) COMPONENT render — RatioCard + OpenPhase render the REAL locale-produced strings ──────────

describe('(D) RatioCard / OpenPhase — genuine ES component render of the real service output (T-R47)', () => {
  const tally: AgentRatioTally = { introductions: 5, responses: 3, appointmentsSet: 1, confirmedShows: 0, dataPointCount: 5 };

  test('RatioCard — EN default renders the real English explainer + learning label', () => {
    const view = buildAgentRatioCardView(tally);
    const text = textOf(renderEn(RatioCard, { title: "Agent's Ratio", view }));
    expect(text).toContain('learning your community');
    expect(text).toContain("Your Agent's Ratio measures how effective your AI agents are");
  });

  test('RatioCard — genuinely renders the real Spanish explainer + learning label (not a silent EN fallback)', () => {
    const view = buildAgentRatioCardView(tally, 'es');
    const text = textOf(renderEs(RatioCard, { title: 'Proporción del Agente', view }));
    expect(text).toContain('conociendo tu comunidad');
    expect(text).toContain('La Proporción de tu Agente mide qué tan efectivos son tus agentes de IA');
    expect(text).not.toContain('learning your community');
    expect(text).not.toContain("Your Agent's Ratio");
  });

  const openPropsEn = {
    briefingLines: [t('en', 'shift.openPhase.briefingCount', { count: 3 })],
    motivationalLine: t('en', 'shift.openPhase.motivationalLine'),
    streakCount: 2,
    graceDayOffer: false,
    mode: 'STANDARD' as const,
    learningState: { agentRatio: buildAgentRatioCardView(tally), fieldTrainerRatio: buildFieldTrainerRatioCardView({ appointmentsRun: 3, closes: 1, dataPointCount: 3 }), computedAt: 'x' },
    onBegin: noop,
  };

  test('OpenPhase — EN default renders the real briefing count + motivational line + ratio explainers', () => {
    const text = textOf(renderEn(OpenPhase, openPropsEn));
    expect(text).toContain('3 items ready for your review.');
    expect(text).toContain('Small, steady attention compounds.');
    expect(text).toContain("Your Agent's Ratio measures");
    expect(text).toContain("Your Field Trainer's Ratio measures");
  });

  const openPropsEs = {
    ...openPropsEn,
    briefingLines: [t('es', 'shift.openPhase.briefingCount', { count: 3 })],
    motivationalLine: t('es', 'shift.openPhase.motivationalLine'),
    learningState: { agentRatio: buildAgentRatioCardView(tally, 'es'), fieldTrainerRatio: buildFieldTrainerRatioCardView({ appointmentsRun: 3, closes: 1, dataPointCount: 3 }, 'es'), computedAt: 'x' },
  };

  test('OpenPhase — genuinely renders Spanish briefing count + motivational line + BOTH ratio explainers (not a silent EN fallback)', () => {
    const text = textOf(renderEs(OpenPhase, openPropsEs));
    expect(text).toContain('3 elementos listos para tu revisión.');
    expect(text).toContain('La atención pequeña y constante se acumula.');
    expect(text).toContain('La Proporción de tu Agente mide qué tan efectivos son tus agentes de IA');
    expect(text).toContain('La Proporción de tu Entrenador de Campo mide la tasa de cierre');
    expect(text).not.toContain('items ready for your review');
    expect(text).not.toContain('Small, steady attention compounds');
    expect(text).not.toContain("Your Agent's Ratio");
    expect(text).not.toContain("Your Field Trainer's Ratio");
  });
});
