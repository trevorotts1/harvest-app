// WP08 §13.4 — the real Inngest cron registration for the taprooting milestone/stagnation sweep.
// Registered into the shared serve endpoint (`src/app/api/inngest/route.ts`) exactly like the
// agent-runtime and messaging cron functions — this IS the reachable production caller for
// `runTaprootingSweep`/`runMilestoneDetection`; there is no dead scaffold here.

import { inngest } from '@/lib/inngest/client';
import { runTaprootingSweep, TAPROOTING_SWEEP_CRON, TAPROOTING_SWEEP_FUNCTION_ID } from '../sweep';

export const taprootingSweepFunction = inngest.createFunction(
  { id: TAPROOTING_SWEEP_FUNCTION_ID, name: 'Taprooting milestone & stagnation sweep (WP08 §13.4)' },
  { cron: TAPROOTING_SWEEP_CRON },
  async ({ step }) => {
    return step.run('taprooting-sweep', () => runTaprootingSweep());
  }
);

export const taprootingInngestFunctions = [taprootingSweepFunction];
