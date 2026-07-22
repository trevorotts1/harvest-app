// WP04 (T-32) — Zone 5: Ratio cards (uiux §5.2 item 5 / §4.1 Ratio Card, master-spec §9.7).
//
// Agent's Ratio ("introductions → responses → appointments set → confirmed shows", §9.7) is
// rendered here as the same three-number shape the spec's own baseline example uses ("20 : 5 : 1" —
// §9.7/uiux §5.2): introductions (real, approved DraftMessage sends), appointments set (real
// Appointment rows), confirmed shows (Appointments actually run — Contact rows that progressed to
// MET/closed). Field Trainer's Ratio ("appointments run → client signs / recruit joins", §9.7) is
// shown as appointments run / client signs / recruit joins. Both stay in the "learning your
// community" baseline (20:5:1, master spec §9.7) until real data accumulates — never a fabricated
// performance number, never `NaN` (uiux AC-4-5).

import { RATIO_BASELINE, RATIO_LEARNING_THRESHOLD } from '../types';
import type { RatioTriple, RatiosZoneData } from '../types';
import type { MissionControlPrismaClient } from '../prisma-types';
// T-57 (server-msg-i18n) — every explainer/label below used to be bare English literals composed
// server-side and rendered raw by RatioCards.tsx (`ratio.explainer`, `ratio.labels.join(' → ')` —
// only the zone heading and the two ratio TITLES were already client-translated, per T-R32b). Also
// fixes the pre-existing bare-count plural bug (e.g. "1 introductions" was always plural, the SAME
// class of bug briefing.ts's CLDR fix (T-57 R4-residual2) already retired there) via real CLDR
// one/other on each independent count, mirroring that fix's "each part-phrase is its own independent
// t() call with its OWN count" pattern. `locale` is an OPTIONAL trailing param (defaulting to
// `DEFAULT_LOCALE`) threaded in from today.service.ts; every existing caller/test that omits it keeps
// compiling and rendering byte-identical English (this zone builder had zero dedicated unit-test
// string assertions before this fix — see the T-57 server-msg-i18n build report).
import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

const MET_OR_CLOSED = ['MET', 'CLOSED_CLIENT', 'CLOSED_RECRUIT'];

function agentRatioExplainer(introductions: number, appointmentsSet: number, confirmedShows: number, locale: Locale): string {
  return t(locale, 'today.zones.ratios.agentRecord.template', {
    introPart: t(locale, 'today.zones.ratios.agentRecord.introPart', { count: introductions }),
    apptPart: t(locale, 'today.zones.ratios.agentRecord.apptPart', { count: appointmentsSet }),
    showsPart: t(locale, 'today.zones.ratios.agentRecord.showsPart', { count: confirmedShows }),
  });
}

function fieldTrainerRatioExplainer(appointmentsRun: number, clientSigns: number, recruitJoins: number, locale: Locale): string {
  return t(locale, 'today.zones.ratios.trainerRecord.template', {
    runPart: t(locale, 'today.zones.ratios.trainerRecord.runPart', { count: appointmentsRun }),
    signPart: t(locale, 'today.zones.ratios.trainerRecord.signPart', { count: clientSigns }),
    joinPart: t(locale, 'today.zones.ratios.trainerRecord.joinPart', { count: recruitJoins }),
  });
}

function baselineTriple(labels: [string, string, string], dataPoints: number, explainer: string): RatioTriple {
  return {
    a: RATIO_BASELINE[0],
    b: RATIO_BASELINE[1],
    c: RATIO_BASELINE[2],
    labels,
    learning: true,
    dataPoints,
    explainer,
  };
}

export async function buildRatiosZone(
  db: MissionControlPrismaClient,
  userId: string,
  locale: Locale = DEFAULT_LOCALE
): Promise<RatiosZoneData> {
  const [approvedDrafts, appointments, contacts] = await Promise.all([
    db.draftMessage.findMany({ where: { user_id: userId, approval_state: 'APPROVED' } }),
    db.appointment.findMany({ where: { rep_id: userId } }),
    db.contact.findMany({ where: { user_id: userId } }),
  ]);

  const introductions = approvedDrafts.length;
  const appointmentsSet = appointments.length;
  const confirmedShows = appointments.filter((a) => a.status === 'CONFIRMED').length;

  const appointmentsRun = contacts.filter((c) => MET_OR_CLOSED.includes(c.pipeline_stage)).length;
  const clientSigns = contacts.filter((c) => c.is_client).length;
  const recruitJoins = contacts.filter((c) => c.pipeline_stage === 'CLOSED_RECRUIT').length;

  const agentLabels: [string, string, string] = [
    t(locale, 'today.zones.ratios.labels.introductions'),
    t(locale, 'today.zones.ratios.labels.appointmentsSet'),
    t(locale, 'today.zones.ratios.labels.confirmedShows'),
  ];
  const trainerLabels: [string, string, string] = [
    t(locale, 'today.zones.ratios.labels.appointmentsRun'),
    t(locale, 'today.zones.ratios.labels.clientSigns'),
    t(locale, 'today.zones.ratios.labels.recruitJoins'),
  ];

  const agentRatio: RatioTriple =
    introductions < RATIO_LEARNING_THRESHOLD
      ? baselineTriple(agentLabels, introductions, t(locale, 'today.zones.ratios.agentBaselineExplainer'))
      : {
          a: introductions,
          b: appointmentsSet,
          c: confirmedShows,
          labels: agentLabels,
          learning: false,
          dataPoints: introductions,
          explainer: agentRatioExplainer(introductions, appointmentsSet, confirmedShows, locale),
        };

  const fieldTrainerRatio: RatioTriple =
    appointmentsRun < RATIO_LEARNING_THRESHOLD
      ? baselineTriple(trainerLabels, appointmentsRun, t(locale, 'today.zones.ratios.trainerBaselineExplainer'))
      : {
          a: appointmentsRun,
          b: clientSigns,
          c: recruitJoins,
          labels: trainerLabels,
          learning: false,
          dataPoints: appointmentsRun,
          explainer: fieldTrainerRatioExplainer(appointmentsRun, clientSigns, recruitJoins, locale),
        };

  return { agentRatio, fieldTrainerRatio };
}
