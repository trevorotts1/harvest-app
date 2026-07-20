// T-45 (WP09 §9.6/§16.6; uiux §5.9 AC-5.9-4, QC checkpoint 11) — getRepDrillIn: cross-org access
// resolves to `null` (→ 404 at the route, never a 403 that would confirm existence), a caller who is
// not the target's actual upline is denied, names-in-play are coarse (first name + last initial)
// never raw contact PII, and the privacy-boundary card is ALWAYS present verbatim.

import { getRepDrillIn, type RepDrillInPrismaClient } from '../../src/services/team-calendar/rep-drill-in.service';
import { encryptRequiredField } from '../../src/services/warm-market/vault/vault-encryption';

function makeMockPrisma(fixtures: {
  users?: Record<string, { id: string; name: string; upline_id: string | null; organization_id: string | null }>;
  contacts?: { id: string; first_name: string; last_name: string; pipeline_stage: string; is_client: boolean; last_contact_date: Date | null; user_id: string }[];
  appointments?: { id: string; status: string; contact_id: string; confirmed_start: Date | null; rep_id: string }[];
  attendance?: { id: string; event_id: string; state: string; created_at: Date; user_id: string }[];
  milestones?: { milestone_key: string; achieved_at: Date; celebrated: boolean; user_id: string }[];
}): RepDrillInPrismaClient {
  return {
    user: {
      async findUnique({ where }) {
        return fixtures.users?.[where.id] ?? null;
      },
    },
    contact: {
      async findMany({ where }) {
        const userId = (where as { user_id?: string }).user_id;
        return (fixtures.contacts ?? []).filter((c) => c.user_id === userId);
      },
    },
    appointment: {
      async findMany({ where }) {
        const repId = (where as { rep_id?: string }).rep_id;
        return (fixtures.appointments ?? []).filter((a) => a.rep_id === repId);
      },
    },
    attendance: {
      async findMany({ where }) {
        const userId = (where as { user_id?: string }).user_id;
        return (fixtures.attendance ?? []).filter((a) => a.user_id === userId);
      },
    },
    milestone: {
      async findMany({ where }) {
        const userId = (where as { user_id?: string }).user_id;
        return (fixtures.milestones ?? []).filter((m) => m.user_id === userId);
      },
    },
  };
}

describe('WP09 getRepDrillIn — org-gating + privacy boundary', () => {
  it('returns null for a rep in a DIFFERENT organization — the route turns this into a 404, never a 403', async () => {
    const prisma = makeMockPrisma({
      users: {
        'rep-1': { id: 'rep-1', name: 'Rep One', upline_id: 'upline-1', organization_id: 'org-2' },
      },
    });
    const result = await getRepDrillIn(prisma, { id: 'upline-1', role: 'UPLINE', organizationId: 'org-1' }, 'rep-1');
    expect(result).toBeNull();
  });

  it('returns null when the caller is not this rep\'s actual upline (even same-org)', async () => {
    const prisma = makeMockPrisma({
      users: {
        'rep-1': { id: 'rep-1', name: 'Rep One', upline_id: 'someone-else', organization_id: 'org-1' },
      },
    });
    const result = await getRepDrillIn(prisma, { id: 'upline-1', role: 'UPLINE', organizationId: 'org-1' }, 'rep-1');
    expect(result).toBeNull();
  });

  it('returns null for a genuinely nonexistent rep id — indistinguishable from the above', async () => {
    const prisma = makeMockPrisma({ users: {} });
    const result = await getRepDrillIn(prisma, { id: 'upline-1', role: 'UPLINE', organizationId: 'org-1' }, 'ghost-id');
    expect(result).toBeNull();
  });

  it('an RVP sees any rep in their organization (org-wide), even one who is not their direct downline', async () => {
    const prisma = makeMockPrisma({
      users: { 'rep-1': { id: 'rep-1', name: 'Rep One', upline_id: 'some-upline', organization_id: 'org-1' } },
    });
    const result = await getRepDrillIn(prisma, { id: 'rvp-1', role: 'RVP', organizationId: 'org-1' }, 'rep-1');
    expect(result).not.toBeNull();
  });

  it('allows the direct upline and ALWAYS carries the verbatim privacy-boundary card + coarse names-in-play (never raw PII)', async () => {
    const prisma = makeMockPrisma({
      users: { 'rep-1': { id: 'rep-1', name: 'Rep One', upline_id: 'upline-1', organization_id: 'org-1' } },
      contacts: [
        { id: 'contact-1', first_name: encryptRequiredField('Sarah'), last_name: encryptRequiredField('Martinez'), pipeline_stage: 'ENGAGED', is_client: false, last_contact_date: new Date(), user_id: 'rep-1' },
      ],
    });
    const result = await getRepDrillIn(prisma, { id: 'upline-1', role: 'UPLINE', organizationId: 'org-1' }, 'rep-1');

    expect(result).not.toBeNull();
    expect(result!.privacyBoundary).toBe("Conversation content and contact details belong to Rep One. You'll see them if you're brought into a three-way.");
    expect(result!.namesInPlay.length).toBe(1);
    expect(result!.namesInPlay[0].displayName).toBe('Sarah M.');
    // Never the raw ciphertext, never a phone/email/notes field anywhere in the payload.
    expect(JSON.stringify(result)).not.toContain('Martinez');
    expect(JSON.stringify(result)).not.toMatch(/phone|email|notes/i);
  });

  it('pipeline-state counts are aggregate — no per-contact conversation content anywhere', async () => {
    const prisma = makeMockPrisma({
      users: { 'rep-1': { id: 'rep-1', name: 'Rep One', upline_id: 'upline-1', organization_id: 'org-1' } },
      contacts: [
        { id: 'c1', first_name: encryptRequiredField('A'), last_name: encryptRequiredField('B'), pipeline_stage: 'ENGAGED', is_client: false, last_contact_date: null, user_id: 'rep-1' },
        { id: 'c2', first_name: encryptRequiredField('C'), last_name: encryptRequiredField('D'), pipeline_stage: 'ENGAGED', is_client: false, last_contact_date: null, user_id: 'rep-1' },
      ],
    });
    const result = await getRepDrillIn(prisma, { id: 'upline-1', role: 'UPLINE', organizationId: 'org-1' }, 'rep-1');
    expect(result!.pipelineStateCounts.ENGAGED).toBe(2);
  });
});
