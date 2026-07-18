// WP04 (T-32) — Zone 2: Overnight Briefing (uiux §5.2 item 2 / §4.1 Briefing Card).
//
// KNOWN SEAM GAP (stated, not silently worked around): the T-30 agent runtime (agent-runtime.ts,
// out of this unit's lane — "CONSUME T-30, do NOT modify the runtime core") persists a plain-
// language `reasoning_log` DESCRIPTION per AgentRun (e.g. "Reporting Agent composed the briefing
// narrative on claude-sonnet-5. CFE clear (score 4) -> entered the Approval Inbox.") but never
// persists the Reporting Agent's actual Sonnet-5-composed prose anywhere (`output.text` is
// generated, CFE-evaluated, and then discarded once the request completes — there is no DraftMessage
// for `rep_facing` output, since one is only created for `contact_outbound` surfaces with a
// `contactId`). So this zone cannot "replay" the Reporting Agent's literal sentence. Rather than
// fabricate prose to fill that gap (a doctrine violation — master spec §18.6 "no fabricated content
// ever"), this builder composes its narrative lines DETERMINISTICALLY from real, aggregated Activity
// Ledger rows (AgentRun grouped by agent_key/status, DraftMessage counts by CFE outcome) for this
// rep's real overnight window — genuinely real data, off the real T-30 stream, exactly as the ticket
// requires; it just does not literally quote Sonnet's discarded raw text. Each line still carries
// real receipts resolving to real AgentRun rows (uiux AC-5.2-9 / AC-4-10).

import { AgentKey, getAgentSpec } from '@/services/agent-runtime';
import type { AgentRunRow, DraftMessageRow, MissionControlPrismaClient } from '../prisma-types';
import type { BriefingLine, BriefingReceipt, BriefingZoneData } from '../types';

const OVERNIGHT_WINDOW_MS = 24 * 60 * 60 * 1000;
const CFE_BAND_RE = /CFE (clear|review|blocked)/;

function cfeBandOf(run: AgentRunRow): string | null {
  const m = run.reasoning_log?.match(CFE_BAND_RE);
  return m ? m[1] : null;
}

function receiptOf(run: AgentRunRow): BriefingReceipt {
  const spec = Object.values(AgentKey).includes(run.agent_key as AgentKey)
    ? getAgentSpec(run.agent_key as AgentKey)
    : null;
  return {
    agentRunId: run.id,
    agentKey: run.agent_key,
    agentDisplayName: spec?.displayName ?? run.agent_key,
    action: run.reasoning_log ?? `${run.agent_key} ran (${run.status}).`,
    when: (run.finished_at ?? run.created_at).toISOString(),
    cfeBand: cfeBandOf(run),
  };
}

const HELD_NO_KEY_MARKER = 'the Claude connection is not configured';
const HELD_CFE_DOWN_MARKER = 'double-check compliance';

export async function buildBriefingZone(
  db: MissionControlPrismaClient,
  userId: string,
  now: Date = new Date()
): Promise<BriefingZoneData> {
  const allRuns = await db.agentRun.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: 200,
  });

  if (allRuns.length === 0) {
    return { state: 'first_day', freshnessStamp: null, lines: [] };
  }

  const freshnessStamp = (allRuns[0].finished_at ?? allRuns[0].created_at).toISOString();

  const latestReporting = allRuns.find((r) => r.agent_key === AgentKey.REPORTING);
  if (latestReporting?.status === 'HELD' && latestReporting.reasoning_log) {
    if (
      latestReporting.reasoning_log.includes(HELD_NO_KEY_MARKER) ||
      latestReporting.reasoning_log.includes(HELD_CFE_DOWN_MARKER)
    ) {
      return { state: 'agents_resting', freshnessStamp, lines: [] };
    }
  }

  const windowStart = new Date(now.getTime() - OVERNIGHT_WINDOW_MS);
  const overnightRuns = allRuns.filter((r) => (r.finished_at ?? r.created_at).getTime() >= windowStart.getTime());

  if (overnightRuns.length === 0) {
    return { state: 'empty', freshnessStamp, lines: [] };
  }

  const byAgent = new Map<string, AgentRunRow[]>();
  for (const run of overnightRuns) {
    if (run.status !== 'COMPLETED' && run.status !== 'HELD') continue; // skip still-RUNNING/transient FAILED
    const list = byAgent.get(run.agent_key) ?? [];
    list.push(run);
    byAgent.set(run.agent_key, list);
  }

  const lines: BriefingLine[] = [];
  for (const [agentKey, runs] of byAgent.entries()) {
    const spec = Object.values(AgentKey).includes(agentKey as AgentKey) ? getAgentSpec(agentKey as AgentKey) : null;
    const displayName = spec?.displayName ?? agentKey;
    const clear = runs.filter((r) => cfeBandOf(r) === 'clear').length;
    const flagged = runs.filter((r) => cfeBandOf(r) === 'review').length;
    const held = runs.filter((r) => r.status === 'HELD').length;

    const parts: string[] = [`${clear} cleared`];
    if (flagged > 0) parts.push(`${flagged} flagged for review`);
    if (held > 0) parts.push(`${held} held`);

    lines.push({
      text: `While you slept: your ${displayName} ran ${runs.length} time${runs.length === 1 ? '' : 's'} — ${parts.join(', ')}.`,
      receipts: runs.map(receiptOf),
    });
  }

  const pendingDrafts = await draftsAwaitingApproval(db, userId);
  if (pendingDrafts.length > 0) {
    lines.push({
      text: `${pendingDrafts.length} draft${pendingDrafts.length === 1 ? '' : 's'} waiting for your approval.`,
      receipts: [],
    });
  }

  return { state: 'ready', freshnessStamp, lines };
}

async function draftsAwaitingApproval(db: MissionControlPrismaClient, userId: string): Promise<DraftMessageRow[]> {
  return db.draftMessage.findMany({ where: { user_id: userId, approval_state: { in: ['PENDING', 'HELD'] } } });
}
