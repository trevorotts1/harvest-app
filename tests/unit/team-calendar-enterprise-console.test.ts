// T-45 (WP09 §14.5 P1; §0.3/§4.4) — EnterpriseConsoleService: seat management, the Opus-4.8 org
// narrative (Claude-only, fail-closed on a missing key, CFE-gated before persisting), and the SSO
// config surface that can never mark itself "connected" without a real federation integration.

import { EnterpriseConsoleService, type EnterpriseConsolePrismaClient } from '../../src/services/team-calendar/enterprise-console.service';
import { AnthropicRuntimeClient, MissingClaudeCredentialError } from '../../src/services/agent-runtime/claude';
import { ComplianceFilterEngine } from '../../src/services/compliance/engine';

function makeMockPrisma() {
  const seats = new Map<string, { id: string; organization_id: string; assigned_user_id: string; status: string }>();
  const narratives: { id: string; narrative_text: string; created_at: Date; organization_id: string }[] = [];
  const configs = new Map<string, Record<string, unknown>>();
  let seatCounter = 0;

  const prisma: EnterpriseConsolePrismaClient = {
    enterpriseSeatAssignment: {
      async findMany({ where }) {
        const orgId = (where as { organization_id?: string }).organization_id;
        return Array.from(seats.values()).filter((s) => s.organization_id === orgId);
      },
      async upsert({ create }) {
        const id = `seat-${++seatCounter}`;
        const row = { id, ...create } as { id: string; organization_id: string; assigned_user_id: string; status: string };
        seats.set(id, row);
        return row;
      },
      async update({ where, data }) {
        const existing = seats.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...data };
        seats.set(where.id, updated);
        return updated;
      },
    },
    orgAnalyticsNarrative: {
      async create({ data }) {
        const row = { id: `narrative-${narratives.length + 1}`, narrative_text: data.narrative_text as string, created_at: new Date(), organization_id: data.organization_id as string };
        narratives.push(row);
        return row;
      },
      async findFirst({ where }) {
        const orgId = (where as { organization_id?: string }).organization_id;
        const rows = narratives.filter((n) => n.organization_id === orgId).sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
        return rows[0] ?? null;
      },
    },
    enterpriseOrgConfig: {
      async findUnique({ where }) {
        return (configs.get(where.organization_id) as never) ?? null;
      },
      async upsert({ where, create, update }) {
        const existing = configs.get(where.organization_id);
        const merged = { ...(existing ?? create), ...update };
        configs.set(where.organization_id, merged);
        return merged;
      },
    },
  };
  return { prisma, seats, narratives, configs };
}

describe('WP09 EnterpriseConsoleService', () => {
  describe('seat management', () => {
    it('assigns and revokes a seat, scoped to the organization', async () => {
      const { prisma } = makeMockPrisma();
      const service = new EnterpriseConsoleService(prisma);
      const seat = await service.assignSeat('org-1', 'user-1', 'admin-1');
      expect(seat.status).toBe('ACTIVE');

      const revoked = await service.revokeSeat(seat.id);
      expect(revoked.status).toBe('REVOKED');

      const seats = await service.listSeats('org-1');
      expect(seats.length).toBe(1);
    });
  });

  describe('org analytics narrative — Claude-only, fail-closed (§0.3)', () => {
    it('a missing ANTHROPIC_API_KEY resolves to "unavailable" — never a fabricated narrative, never a non-Claude fallback', async () => {
      const { prisma } = makeMockPrisma();
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        const service = new EnterpriseConsoleService(prisma, new AnthropicRuntimeClient());
        const result = await service.generateNarrative('org-1', { activeReps: 5, appointmentsHeld: 3, recruitsActivated: 2, totalSeatCostCents: 500 }, new Date('2025-01-01'), new Date('2025-02-01'));
        expect(result.status).toBe('unavailable');
      } finally {
        if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });

    it('a generated narrative that the CFE holds/blocks never gets persisted or shown raw', async () => {
      const { prisma, narratives } = makeMockPrisma();
      const fakeModelClient = {
        generate: async () => ({ text: 'Guaranteed income for everyone!', modelId: 'claude-opus-4-8', tier: 'opus_4_8' as never, tokenInput: 10, tokenOutput: 10, batched: true }),
      } as unknown as AnthropicRuntimeClient;
      const fakeCfe = { evaluateContent: async () => ({ held: true, band: 'blocked', released: false }) } as unknown as ComplianceFilterEngine;

      const service = new EnterpriseConsoleService(prisma, fakeModelClient, fakeCfe);
      const result = await service.generateNarrative('org-1', { activeReps: 1, appointmentsHeld: 1, recruitsActivated: 1, totalSeatCostCents: 1 }, new Date(), new Date());

      expect(result.status).toBe('held');
      expect(narratives.length).toBe(0);
    });

    it('a clean CFE verdict persists the narrative and returns it', async () => {
      const { prisma, narratives } = makeMockPrisma();
      const fakeModelClient = {
        generate: async () => ({ text: 'Your team grew steadily this month.', modelId: 'claude-opus-4-8', tier: 'opus_4_8' as never, tokenInput: 10, tokenOutput: 10, batched: true }),
      } as unknown as AnthropicRuntimeClient;
      const fakeCfe = { evaluateContent: async () => ({ held: false, band: 'clear', released: true }) } as unknown as ComplianceFilterEngine;

      const service = new EnterpriseConsoleService(prisma, fakeModelClient, fakeCfe);
      const result = await service.generateNarrative('org-1', { activeReps: 1, appointmentsHeld: 1, recruitsActivated: 1, totalSeatCostCents: 1 }, new Date(), new Date());

      expect(result.status).toBe('generated');
      expect(narratives.length).toBe(1);
    });

    it('MissingClaudeCredentialError is the real error class thrown by the shared Claude-only client', () => {
      expect(new MissingClaudeCredentialError('ANTHROPIC_API_KEY')).toBeInstanceOf(Error);
    });
  });

  describe('SSO config — never auto-connects (stated deviation)', () => {
    it('updateSsoConfig always sets status to "pending", never "connected"', async () => {
      const { prisma } = makeMockPrisma();
      const service = new EnterpriseConsoleService(prisma);
      const config = (await service.updateSsoConfig('org-1', 'okta', 'https://example.com/metadata', 'admin-1')) as { sso_status: string };
      expect(config.sso_status).toBe('pending');
      expect(config.sso_status).not.toBe('connected');
    });
  });
});
