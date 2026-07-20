// T-45 (WP09 — master-spec §9.6/§16.6; uiux §5.9 "privacy boundary (rendered, not just enforced)")
// — the rep drill-in (`/team/rep/{id}`). Shows pipeline STATES, ratios, names-in-play (first name +
// last initial only — the same coarse identification level already used elsewhere, e.g. the
// needs-you-now strip), attendance, and milestones — and ALWAYS returns an explicit boundary-card
// string at the point where PII/conversation content would begin (QC checkpoint 11, uiux AC-5.9-4).
//
// ORG-GATING (§16.6, the platform invariant "cross-org access → 404"): `getDrillIn` returns `null`
// for a target rep who is not in the caller's organization, OR who is not the caller's direct
// downline (for an UPLINE/DUAL caller) — indistinguishable from "does not exist." The route
// (src/app/api/team/rep/[userId]/route.ts) converts `null` to a plain 404, never a 403 that would
// confirm existence.

import { decryptRequiredField, getContactEncryptionKey } from '../warm-market/vault/vault-encryption';

export interface RepDrillInPrismaClient {
  user: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; name: string; upline_id: string | null; organization_id: string | null } | null>;
  };
  contact: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ id: string; first_name: string; last_name: string; pipeline_stage: string; is_client: boolean; last_contact_date: Date | null }[]>;
  };
  appointment: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ id: string; status: string; contact_id: string; confirmed_start: Date | null }[]>;
  };
  attendance: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ id: string; event_id: string; state: string; created_at: Date }[]>;
  };
  milestone: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ milestone_key: string; achieved_at: Date; celebrated: boolean }[]>;
  };
}

export interface NameInPlay {
  contactId: string;
  displayName: string; // "Sarah M." — first name + last initial only, never full PII
  pipelineStage: string;
}

export interface RepDrillIn {
  repUserId: string;
  repName: string;
  pipelineStateCounts: Record<string, number>;
  namesInPlay: NameInPlay[];
  appointments: { id: string; status: string; whenIso: string | null }[];
  attendance: { eventId: string; state: string }[];
  milestones: { key: string; achievedAtIso: string; celebrated: boolean }[];
  /** uiux §5.9 verbatim boundary-card copy — rendered at every PII edge. */
  privacyBoundary: string;
}

function coarseName(firstName: string, lastName: string): string {
  let first: string;
  let lastInitial: string;
  try {
    const key = getContactEncryptionKey();
    first = decryptRequiredField(firstName, key);
    const last = lastName ? decryptRequiredField(lastName, key) : '';
    lastInitial = last ? `${last.charAt(0).toUpperCase()}.` : '';
  } catch {
    return 'A community member'; // no encryption key available — never show ciphertext, never crash
  }
  return lastInitial ? `${first} ${lastInitial}` : first;
}

export async function getRepDrillIn(
  prisma: RepDrillInPrismaClient,
  caller: { id: string; role: string; organizationId: string | null },
  targetRepId: string,
  orgWideRoles: readonly string[] = ['RVP', 'ADMIN']
): Promise<RepDrillIn | null> {
  const target = await prisma.user.findUnique({ where: { id: targetRepId } });
  if (!target) return null;

  // Cross-org access → 404 (never distinguish from "does not exist").
  if (!caller.organizationId || target.organization_id !== caller.organizationId) return null;

  // Row-level scope (§16.6 row 2): RVP/ADMIN see org-wide; UPLINE/DUAL must be this rep's actual upline.
  const orgWide = orgWideRoles.includes(caller.role);
  if (!orgWide && target.upline_id !== caller.id) return null;

  const [contacts, appointments, attendanceRows, milestones] = await Promise.all([
    prisma.contact.findMany({ where: { user_id: targetRepId } }),
    prisma.appointment.findMany({ where: { rep_id: targetRepId } }),
    prisma.attendance.findMany({ where: { user_id: targetRepId } }),
    prisma.milestone.findMany({ where: { user_id: targetRepId } }),
  ]);

  const pipelineStateCounts: Record<string, number> = {};
  for (const c of contacts) {
    pipelineStateCounts[c.pipeline_stage] = (pipelineStateCounts[c.pipeline_stage] ?? 0) + 1;
  }

  const namesInPlay: NameInPlay[] = contacts
    .filter((c) => !['CLOSED_CLIENT', 'CLOSED_RECRUIT', 'LOST'].includes(c.pipeline_stage))
    .map((c) => ({ contactId: c.id, displayName: coarseName(c.first_name, c.last_name), pipelineStage: c.pipeline_stage }));

  return {
    repUserId: target.id,
    repName: target.name,
    pipelineStateCounts,
    namesInPlay,
    appointments: appointments.map((a) => ({ id: a.id, status: a.status, whenIso: a.confirmed_start ? a.confirmed_start.toISOString() : null })),
    attendance: attendanceRows.map((a) => ({ eventId: a.event_id, state: a.state })),
    milestones: milestones.map((m) => ({ key: m.milestone_key, achievedAtIso: m.achieved_at.toISOString(), celebrated: m.celebrated })),
    privacyBoundary: `Conversation content and contact details belong to ${target.name}. You'll see them if you're brought into a three-way.`,
  };
}
