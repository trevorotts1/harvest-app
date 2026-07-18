// WP04 (T-30) — the nine agent handlers (§4.2). Each is a small, STATELESS function: it assembles a
// prompt (§4.3), calls the injected Claude client on the tier §4.4 mandates for the step, and returns
// an AgentOutput. It NEVER persists, NEVER calls the CFE, and NEVER decides surfacing — the runtime
// owns all of that (so the CFE gate is a single choke point no handler can bypass).
//
// Handlers that draft contact-bound copy return `surface: 'contact_outbound'` (→ CFE + Approval
// Inbox). Reporting returns `rep_facing` (still CFE-gated, §5.4). Quota/IPA return `internal`
// (numeric/analytic; the IPA self-optimization step is Opus 4.8 + batched, OFF the per-message path).

import { AgentHandler, AgentHandlerContext, AgentOutput } from './types';
import { AgentKey } from './runtime-model-map';

async function draftContactOutbound(ctx: AgentHandlerContext, role: string, task: string): Promise<AgentOutput> {
  // Optional Haiku 4.5 segmentation/prioritize step (§4.4) via the INJECTED HaikuSegmentationClient.
  let relationshipNote = '';
  if (ctx.input.segmentContactId) {
    const seg = await ctx.segment(ctx.input.segmentContactId);
    relationshipNote = ` (relationship inferred: ${seg.relationshipType})`;
  }
  const gen = await ctx.generateStep(role, 'contact_outbound', task + relationshipNote);
  return {
    surface: 'contact_outbound',
    text: gen.text,
    channel: ctx.input.channel,
    reasoning: `${ctx.spec.displayName} drafted a community introduction/touch on ${gen.modelId}${relationshipNote}.`,
    usage: {
      tier: gen.tier,
      tokenInput: gen.tokenInput,
      tokenOutput: gen.tokenOutput,
      batched: gen.batched,
      modelId: gen.modelId,
    },
  };
}

function usageOf(gen: Awaited<ReturnType<AgentHandlerContext['generateStep']>>): AgentOutput['usage'] {
  return {
    tier: gen.tier,
    tokenInput: gen.tokenInput,
    tokenOutput: gen.tokenOutput,
    batched: gen.batched,
    modelId: gen.modelId,
  };
}

export const AGENT_HANDLERS: Record<AgentKey, AgentHandler> = {
  [AgentKey.PROSPECTING]: {
    key: AgentKey.PROSPECTING,
    handle: (ctx) => draftContactOutbound(ctx, 'draft', 'First-touch community introduction for a high-readiness warm-market contact.'),
  },
  [AgentKey.PRE_SALE_NURTURE]: {
    key: AgentKey.PRE_SALE_NURTURE,
    handle: (ctx) => draftContactOutbound(ctx, 'draft', 'A non-harassing nurture touch for an introduced-but-not-scheduled contact.'),
  },
  [AgentKey.POST_SALE_NURTURE]: {
    key: AgentKey.POST_SALE_NURTURE,
    handle: (ctx) => draftContactOutbound(ctx, 'draft', 'A warm check-in / referral ask / renewal note for an onboarded client or recruit.'),
  },
  [AgentKey.APPOINTMENT_SETTING]: {
    key: AgentKey.APPOINTMENT_SETTING,
    handle: (ctx) => draftContactOutbound(ctx, 'negotiation_draft', 'Propose or confirm a meeting time from dual-calendar overlap.'),
  },
  [AgentKey.REPORTING]: {
    key: AgentKey.REPORTING,
    handle: async (ctx) => {
      const gen = await ctx.generateStep('narrative', 'rep_facing', 'Compose the overnight briefing / evening recap narrative for the rep, with honest numbers.');
      return {
        surface: 'rep_facing',
        text: gen.text,
        reasoning: `${ctx.spec.displayName} composed the briefing narrative on ${gen.modelId}.`,
        usage: usageOf(gen),
      };
    },
  },
  [AgentKey.QUOTA]: {
    key: AgentKey.QUOTA,
    handle: async (ctx) => {
      const gen = await ctx.generateStep('track', 'internal', 'Compare this week’s targets vs. actuals and flag underperformance early.');
      return {
        surface: 'internal',
        text: gen.text,
        reasoning: `${ctx.spec.displayName} tracked weekly pace on ${gen.modelId}.`,
        usage: usageOf(gen),
      };
    },
  },
  [AgentKey.IPA_VALUE]: {
    key: AgentKey.IPA_VALUE,
    handle: async (ctx) => {
      // §4.4/§9.9-10/§9.9-11: the periodic self-optimization is the ONLY Opus 4.8 runtime workload,
      // BATCHED and OFF the per-message path. Real-time metric refreshes stay on Haiku 4.5.
      const isSelfOpt = /self.?opt|periodic|optimi/i.test(ctx.input.trigger);
      const role = isSelfOpt ? 'self_optimization' : 'metrics';
      const gen = await ctx.generateStep(role, 'internal', isSelfOpt
        ? 'Periodic, batched self-optimization of this rep’s messaging/timing from their own ratios.'
        : 'Refresh the Agent’s Ratio and Field Trainer’s Ratio from the latest pipeline data.');
      return {
        surface: 'internal',
        text: gen.text,
        reasoning: `${ctx.spec.displayName} ran ${isSelfOpt ? 'periodic self-optimization (batched)' : 'a real-time metrics refresh'} on ${gen.modelId}.`,
        usage: usageOf(gen),
      };
    },
  },
  [AgentKey.INACTIVITY_REENGAGEMENT]: {
    key: AgentKey.INACTIVITY_REENGAGEMENT,
    handle: (ctx) => draftContactOutbound(ctx, 'reengagement_copy', 'Anchor-tied win-back copy for a stalled contact (3/5/7-day cadence).'),
  },
  [AgentKey.WARM_MARKET_SUB]: {
    key: AgentKey.WARM_MARKET_SUB,
    handle: (ctx) => draftContactOutbound(ctx, 'draft', 'Execute a first community introduction for a name highlighted by the Harvest Method.'),
  },
};
