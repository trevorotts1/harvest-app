// T-41 (WP06 §11.1/§11.3, AC §11.8-2) — the rep-facing REAL production caller for weekly-batch
// generation (in addition to the Monday-morning cron, inngest-functions.ts). A rep can trigger "this
// week's batch" on demand from the Content Queue page.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildContentBatchService } from '@/services/social-content/production-wiring';
import { AgentModelError, AgentModelTimeoutError, MissingClaudeCredentialError } from '@/services/agent-runtime/claude';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const service = buildContentBatchService(prisma);
  try {
    const result = await service.generateWeeklyBatch(identity.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof MissingClaudeCredentialError) {
      // Fail CLOSED (§0.3 rule 3): no key -> no fabricated batch, ever.
      return NextResponse.json(
        {
          error: 'Held: your agents are resting — the Claude connection is not configured. Nothing was lost.',
          code: 'AGENT_CREDENTIAL_MISSING',
        },
        { status: 503 }
      );
    }
    if (err instanceof AgentModelTimeoutError || err instanceof AgentModelError) {
      return NextResponse.json(
        { error: 'Generation failed — nothing was lost. Try again shortly.', code: 'AGENT_GENERATION_FAILED' },
        { status: 502 }
      );
    }
    throw err;
  }
});
