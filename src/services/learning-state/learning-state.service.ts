// T-34 (master-spec §9.7 "the two ratios", §9.5 item 5, §9.8 heading, §9.9-7) — recomputes both
// ratios from REAL rep data (Contact.pipeline_stage + Appointment, both pre-existing trunk models
// this build unit only READS — see prisma/schema.prisma; T-30's agent-runtime internals are never
// touched) and persists the durable `LearningState` row so the rep's current learning state
// survives across requests/instances.
//
// Persists via a narrow, DI-mockable Prisma delegate (same convention as
// `HarvestMethodPrismaClient` in method-state.service.ts / `OnboardingGatePrismaClient` in
// onboarding-gate.ts) — tests supply an in-memory fake, no live database required.
//
// BUILD-SAFETY: the real `PrismaClient` is only ever instantiated as this class's constructor
// DEFAULT parameter, so it is created lazily the moment a route handler does `new
// LearningStateService()` per-request — never at module scope, never during `next build`'s
// page-data collection.

import { PrismaClient } from '@prisma/client';

import {
  buildAgentRatioCardView,
  buildFieldTrainerRatioCardView,
  computeAgentRatio,
  computeFieldTrainerRatio,
  deriveLearningStateStatus,
  type PipelineStageLike,
} from './ratios';
import type { LearningStateView } from '@/types/learning-state';
// T-R47 (rep-facing i18n leak fix) — locale resolution, same duck-typed `db.user.findUnique`
// convention `today.service.ts`'s own `resolveRepLocale` established (see that file's header for
// the full rationale): in production `prisma` is the real Prisma client, which really does have
// `.user.findUnique` even though `LearningStatePrismaClient` (this file's own narrow DI surface,
// same "each service owns its own narrow interface" convention as every sibling *PrismaClient type
// in this codebase) declares no `user` accessor — widening that interface is out of this fix's
// lane. Any `db` lacking `.user` (every existing test's in-memory fake) safely falls through to
// `DEFAULT_LOCALE`. Never throws — a locale-lookup hiccup degrades to English, it must never fail
// the ratio computation.
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locale';

type LocaleCapableDb = {
  user?: {
    findUnique?: (args: { where: { id: string }; select: { locale: true } }) => Promise<{ locale: string | null } | null>;
  };
};

async function resolveRepLocale(db: LearningStatePrismaClient, userId: string, explicitLocale?: Locale): Promise<Locale> {
  if (explicitLocale) return explicitLocale;
  const maybeUser = (db as unknown as LocaleCapableDb).user;
  if (typeof maybeUser?.findUnique !== 'function') return DEFAULT_LOCALE;
  try {
    const user = await maybeUser.findUnique({ where: { id: userId }, select: { locale: true } });
    return isLocale(user?.locale) ? user.locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export interface LearningStateContactRow {
  id: string;
  pipeline_stage: PipelineStageLike;
}

export interface LearningStateAppointmentRow {
  contact_id: string;
  trainer_id: string | null;
  status: string;
}

export interface LearningStateRow {
  user_id: string;
  status: string;
  agent_introductions: number;
  agent_responses: number;
  agent_appointments_set: number;
  agent_confirmed_shows: number;
  trainer_appointments_run: number;
  trainer_closes: number;
  computed_at: Date;
}

export interface LearningStatePrismaClient {
  contact: {
    findMany(args: {
      where: { user_id: string };
      select: { id: true; pipeline_stage: true };
    }): Promise<LearningStateContactRow[]>;
  };
  appointment: {
    findMany(args: {
      where: { rep_id: string };
      select: { contact_id: true; trainer_id: true; status: true };
    }): Promise<LearningStateAppointmentRow[]>;
  };
  learningState: {
    upsert(args: {
      where: { user_id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<LearningStateRow>;
  };
}

export class LearningStateService {
  constructor(
    private prisma: LearningStatePrismaClient = new PrismaClient() as unknown as LearningStatePrismaClient
  ) {}

  /**
   * Recomputes both ratios from live data and persists the result, then returns the rep-facing
   * view (baseline-gated, always explained, never a naked number — see ratios.ts). Ownership is
   * enforced entirely by scoping every query to `userId`, which callers must obtain from a verified
   * session identity (never a client-supplied header) — see the /api/learning-state route.
   *
   * T-R47 — `explicitLocale` is optional: every existing caller (the real `/api/learning-state`
   * route, every existing test) omits it and gets the rep's real `User.locale` resolved via the
   * duck-typed lookup above (English unless a real locale says otherwise), IDENTICAL to
   * `today.service.ts`'s own `buildMissionControlToday` resolution.
   */
  async recomputeAndGetView(userId: string, explicitLocale?: Locale): Promise<LearningStateView> {
    const locale = await resolveRepLocale(this.prisma, userId, explicitLocale);
    const contacts = await this.prisma.contact.findMany({
      where: { user_id: userId },
      select: { id: true, pipeline_stage: true },
    });
    const appointments = await this.prisma.appointment.findMany({
      where: { rep_id: userId },
      select: { contact_id: true, trainer_id: true, status: true },
    });

    const stageByContactId = new Map(contacts.map((c) => [c.id, c.pipeline_stage]));

    const agentTally = computeAgentRatio(contacts.map((c) => ({ pipeline_stage: c.pipeline_stage })));
    const trainerTally = computeFieldTrainerRatio(
      appointments.map((a) => ({
        hasTrainer: Boolean(a.trainer_id),
        status: a.status,
        // A contact_id with no matching Contact row (shouldn't happen for a rep's own appointment,
        // but data can be messy) is treated as still-open, never fabricated as a close.
        contactStage: stageByContactId.get(a.contact_id) ?? 'IDENTIFIED',
      }))
    );

    const status = deriveLearningStateStatus(Math.max(agentTally.dataPointCount, trainerTally.dataPointCount));

    const persisted = await this.prisma.learningState.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        status,
        agent_introductions: agentTally.introductions,
        agent_responses: agentTally.responses,
        agent_appointments_set: agentTally.appointmentsSet,
        agent_confirmed_shows: agentTally.confirmedShows,
        trainer_appointments_run: trainerTally.appointmentsRun,
        trainer_closes: trainerTally.closes,
      },
      update: {
        status,
        agent_introductions: agentTally.introductions,
        agent_responses: agentTally.responses,
        agent_appointments_set: agentTally.appointmentsSet,
        agent_confirmed_shows: agentTally.confirmedShows,
        trainer_appointments_run: trainerTally.appointmentsRun,
        trainer_closes: trainerTally.closes,
      },
    });

    return {
      agentRatio: buildAgentRatioCardView(agentTally, locale),
      fieldTrainerRatio: buildFieldTrainerRatioCardView(trainerTally, locale),
      computedAt: persisted.computed_at.toISOString(),
    };
  }
}
