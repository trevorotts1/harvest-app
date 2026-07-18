// WP04 (T-30) — the Inngest serve endpoint (D-4, Vercel-native). Inngest calls this signed webhook
// to invoke the registered agent functions. This is machine-to-machine (verified by Inngest's own
// signing key, read by NAME at request time, §0.4) — it is NOT a session-authenticated user route
// and correctly reads no `x-user-*` identity header, so scripts/verify-api-auth.mjs does not flag it.

import { serve } from 'inngest/next';

import { inngest } from '@/lib/inngest/client';
import { agentRuntimeFunctions } from '@/services/agent-runtime/inngest-functions';

// Per-request (reads the signing key at invocation, not at build) — never statically prerendered.
export const dynamic = 'force-dynamic';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: agentRuntimeFunctions,
});
