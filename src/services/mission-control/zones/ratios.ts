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

function baselineTriple(labels: [string, string, string], dataPoints: number): RatioTriple {
  return { a: RATIO_BASELINE[0], b: RATIO_BASELINE[1], c: RATIO_BASELINE[2], labels, learning: true, dataPoints };
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
      ? baselineTriple(agentLabels, introductions)
      : { a: introductions, b: appointmentsSet, c: confirmedShows, labels: agentLabels, learning: false, dataPoints: introductions };

  const fieldTrainerRatio: RatioTriple =
    appointmentsRun < RATIO_LEARNING_THRESHOLD
      ? baselineTriple(trainerLabels, appointmentsRun)
      : { a: appointmentsRun, b: clientSigns, c: recruitJoins, labels: trainerLabels, learning: false, dataPoints: appointmentsRun };

  return { agentRatio, fieldTrainerRatio };
}
