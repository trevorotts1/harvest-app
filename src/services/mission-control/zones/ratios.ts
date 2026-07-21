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

const MET_OR_CLOSED = ['MET', 'CLOSED_CLIENT', 'CLOSED_RECRUIT'];

// T-R16 (§9.7/§9.9-7 "both ratios display WITH explainers") — "what this means" copy for each ratio,
// baseline vs real-data branch. Display-only text alongside the tally computed below; never itself
// a score (Readiness stays hidden, uiux AC-5.4-4 — these two ratios are the ones that ARE shown).
const AGENT_RATIO_BASELINE_EXPLAINER =
  "Your Agent's Ratio measures how effective your AI agents are: introductions that get a response, " +
  'turn into a set appointment, and show up. New reps start on the community baseline (20 introductions ' +
  'to 5 appointments to 1 confirmed show) until your own record builds up.';
const FIELD_TRAINER_RATIO_BASELINE_EXPLAINER =
  "Your Field Trainer's Ratio measures your trainer's close rate once they run the appointment: how " +
  'many become a client or a new teammate. New reps start on the community baseline (20 appointments ' +
  'run to 5 client signs to 1 recruit join) until enough of your own appointments have run.';

function agentRatioExplainer(introductions: number, appointmentsSet: number, confirmedShows: number): string {
  return (
    `Your own record: ${introductions} introductions -> ${appointmentsSet} appointments set -> ` +
    `${confirmedShows} confirmed shows. This is how effective your AI agents are for your community.`
  );
}

function fieldTrainerRatioExplainer(appointmentsRun: number, clientSigns: number, recruitJoins: number): string {
  return (
    `Your trainer's own record: of ${appointmentsRun} appointments run, ${clientSigns} became a client and ` +
    `${recruitJoins} joined as a recruit.`
  );
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

export async function buildRatiosZone(db: MissionControlPrismaClient, userId: string): Promise<RatiosZoneData> {
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

  const agentLabels: [string, string, string] = ['Introductions', 'Appointments set', 'Confirmed shows'];
  const trainerLabels: [string, string, string] = ['Appointments run', 'Client signs', 'Recruit joins'];

  const agentRatio: RatioTriple =
    introductions < RATIO_LEARNING_THRESHOLD
      ? baselineTriple(agentLabels, introductions, AGENT_RATIO_BASELINE_EXPLAINER)
      : {
          a: introductions,
          b: appointmentsSet,
          c: confirmedShows,
          labels: agentLabels,
          learning: false,
          dataPoints: introductions,
          explainer: agentRatioExplainer(introductions, appointmentsSet, confirmedShows),
        };

  const fieldTrainerRatio: RatioTriple =
    appointmentsRun < RATIO_LEARNING_THRESHOLD
      ? baselineTriple(trainerLabels, appointmentsRun, FIELD_TRAINER_RATIO_BASELINE_EXPLAINER)
      : {
          a: appointmentsRun,
          b: clientSigns,
          c: recruitJoins,
          labels: trainerLabels,
          learning: false,
          dataPoints: appointmentsRun,
          explainer: fieldTrainerRatioExplainer(appointmentsRun, clientSigns, recruitJoins),
        };

  return { agentRatio, fieldTrainerRatio };
}
