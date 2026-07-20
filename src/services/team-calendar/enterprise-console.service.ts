// T-45 (WP09 — master-spec §14.5; uiux §5.9 item 7 "desktop-first extension ... for the $25k tier")
// — the enterprise admin console: seat management, Opus-4.8-composed org analytics narratives,
// custom onboarding config, and the SSO config/status surface.
//
// CLAUDE-ONLY / FAIL-CLOSED (§0.3, §4.4 "Org-level analytic narratives are composed by Opus 4.8,
// sparse, batched"): this module CONSUMES the existing, unmodified `AnthropicRuntimeClient` (the
// same Claude-only client class the nine-agent runtime itself uses — src/services/agent-runtime/
// claude) directly, on the OPUS_4_8 tier, rather than adding a tenth AgentKey to the protected
// runtime-model-map/agent-handlers (which this build must not edit). A missing ANTHROPIC_API_KEY
// throws `MissingClaudeCredentialError`, caught here and resolved to an honest "narrative
// unavailable" result — never a fabricated narrative, never a non-Claude fallback (§0.3 rule 3).
// The generated narrative is additionally run through the existing `ComplianceFilterEngine` before
// being shown/stored (§5.4 "motivational/analytic copy dressed as encouragement is still subject to
// review") — a held/blocked verdict never surfaces the raw narrative.
//
// STATED DEVIATION (SSO): `EnterpriseOrgConfig`'s `sso_*` columns are a real, persisted config/status
// surface (provider id, metadata URL, connection status) an RVP/ADMIN can set today. Actually
// consuming a per-org IdP's live SAML/OIDC assertions requires that org's own IdP client
// secret/certificate, which no org has supplied in this build environment — per §0.4 (no credential
// is ever fabricated) `sso_status` can be set to `pending` here but this module has no path that
// marks it `connected` without a real, later-supplied federation integration (Phase 2).

import { ClaudeModelTier } from '../agent-runtime';
import { AnthropicRuntimeClient, MissingClaudeCredentialError } from '../agent-runtime/claude';
import { ComplianceFilterEngine } from '../compliance/engine';

export interface EnterpriseSeatRow {
  id: string;
  organization_id: string;
  assigned_user_id: string;
  status: string;
}

export interface OrgAnalyticsInputMetrics {
  activeReps: number;
  appointmentsHeld: number;
  recruitsActivated: number;
  totalSeatCostCents: number;
}

export interface EnterpriseConsolePrismaClient {
  enterpriseSeatAssignment: {
    findMany(args: { where: Record<string, unknown> }): Promise<EnterpriseSeatRow[]>;
    upsert(args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<EnterpriseSeatRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<EnterpriseSeatRow>;
  };
  orgAnalyticsNarrative: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; narrative_text: string; created_at: Date }>;
    findFirst(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<{ id: string; narrative_text: string; created_at: Date } | null>;
  };
  enterpriseOrgConfig: {
    findUnique(args: { where: { organization_id: string } }): Promise<{
      organization_id: string;
      onboarding_welcome_message: string | null;
      onboarding_enabled_steps: unknown;
      sso_provider: string | null;
      sso_status: string;
      sso_metadata_url: string | null;
    } | null>;
    upsert(args: { where: { organization_id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
  };
}

export class EnterpriseConsoleService {
  constructor(
    private readonly prisma: EnterpriseConsolePrismaClient,
    private readonly modelClient: AnthropicRuntimeClient = new AnthropicRuntimeClient(),
    private readonly cfe: ComplianceFilterEngine = new ComplianceFilterEngine()
  ) {}

  // ── Seat management (§14.5 "seat management") ────────────────────────────────────────────────────

  async listSeats(organizationId: string): Promise<EnterpriseSeatRow[]> {
    return this.prisma.enterpriseSeatAssignment.findMany({ where: { organization_id: organizationId } });
  }

  async assignSeat(organizationId: string, userId: string, assignedByUserId: string): Promise<EnterpriseSeatRow> {
    return this.prisma.enterpriseSeatAssignment.upsert({
      where: { organization_id_assigned_user_id: { organization_id: organizationId, assigned_user_id: userId } },
      create: { organization_id: organizationId, assigned_user_id: userId, assigned_by_user_id: assignedByUserId, status: 'ACTIVE' },
      update: { status: 'ACTIVE', assigned_by_user_id: assignedByUserId },
    });
  }

  async revokeSeat(seatId: string): Promise<EnterpriseSeatRow> {
    return this.prisma.enterpriseSeatAssignment.update({ where: { id: seatId }, data: { status: 'REVOKED' } });
  }

  // ── Org analytics narrative (§14.5/§4.4, Opus 4.8, batched) ─────────────────────────────────────

  async getLatestNarrative(organizationId: string): Promise<{ id: string; narrativeText: string; createdAt: string } | null> {
    const row = await this.prisma.orgAnalyticsNarrative.findFirst({ where: { organization_id: organizationId }, orderBy: { created_at: 'desc' } });
    if (!row) return null;
    return { id: row.id, narrativeText: row.narrative_text, createdAt: row.created_at.toISOString() };
  }

  /** Generates a fresh org-level narrative on Opus 4.8 (batched), CFE-gated before persisting. Never
   *  called on the per-message path — intended for a periodic (weekly) cron or an explicit RVP/admin
   *  "refresh" action (§4.4 "sparse, scheduled, mostly batched"). */
  async generateNarrative(
    organizationId: string,
    metrics: OrgAnalyticsInputMetrics,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{ status: 'generated'; narrativeText: string } | { status: 'held' } | { status: 'unavailable' }> {
    const systemPrompt =
      'You are the enterprise org-analytics narrator for The Harvest. Compose a short (3-5 sentence), ' +
      'honest, doctrine-clean narrative summarizing this organization\'s activity for its RVP/admin ' +
      'audience. Never guarantee income or promise outcomes; any projected/potential figure must read ' +
      'as potential, not a promise. Use the platform vocabulary (community members, introductions, ' +
      'appointments) — never "prospects," "leads," or "pitches."';
    const userPrompt =
      `Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}.\n` +
      `Active reps: ${metrics.activeReps}. Appointments held: ${metrics.appointmentsHeld}. ` +
      `Recruits activated: ${metrics.recruitsActivated}. Total sponsored-seat cost (cents): ${metrics.totalSeatCostCents}.`;

    let generated: string;
    try {
      const result = await this.modelClient.generate({
        tier: ClaudeModelTier.OPUS_4_8,
        systemPrompt,
        userPrompt,
        batched: true,
      });
      generated = result.text;
    } catch (err) {
      if (err instanceof MissingClaudeCredentialError) return { status: 'unavailable' };
      throw err;
    }

    const verdict = await this.cfe.evaluateContent({
      content: generated,
      channel: 'EMAIL',
      userContext: { user_id: organizationId, role: 'ADMIN' as never, content_id: `org_narrative:${organizationId}` },
    });
    if (verdict.held || verdict.band === 'blocked') return { status: 'held' };

    await this.prisma.orgAnalyticsNarrative.create({
      data: {
        organization_id: organizationId,
        narrative_text: generated,
        model_used: 'opus_4_8',
        period_start: periodStart,
        period_end: periodEnd,
        input_metrics: metrics as unknown as Record<string, unknown>,
      },
    });
    return { status: 'generated', narrativeText: generated };
  }

  // ── Custom onboarding + SSO config (§14.5) ──────────────────────────────────────────────────────

  async getConfig(organizationId: string) {
    return this.prisma.enterpriseOrgConfig.findUnique({ where: { organization_id: organizationId } });
  }

  async updateOnboardingConfig(organizationId: string, welcomeMessage: string | null, enabledSteps: unknown, updatedByUserId: string) {
    return this.prisma.enterpriseOrgConfig.upsert({
      where: { organization_id: organizationId },
      create: { organization_id: organizationId, onboarding_welcome_message: welcomeMessage, onboarding_enabled_steps: enabledSteps, updated_by_user_id: updatedByUserId },
      update: { onboarding_welcome_message: welcomeMessage, onboarding_enabled_steps: enabledSteps, updated_by_user_id: updatedByUserId },
    });
  }

  /** Sets the SSO provider/metadata and moves status to `pending` — never `connected` here (see
   *  this file's header deviation note; real assertion consumption is a Phase-2 integration). */
  async updateSsoConfig(organizationId: string, provider: string, metadataUrl: string, updatedByUserId: string) {
    return this.prisma.enterpriseOrgConfig.upsert({
      where: { organization_id: organizationId },
      create: { organization_id: organizationId, sso_provider: provider, sso_metadata_url: metadataUrl, sso_status: 'pending', updated_by_user_id: updatedByUserId },
      update: { sso_provider: provider, sso_metadata_url: metadataUrl, sso_status: 'pending', updated_by_user_id: updatedByUserId },
    });
  }
}
