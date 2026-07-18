// WP04 (T-30) — the Inngest client (D-4: durable queue, Vercel-native).
//
// Build-safe: constructing the client takes only a static `id` — no secret is read at module scope.
// The Inngest signing/event keys are read from the environment by NAME at send/serve time (§0.4),
// so `next build` in a key-less env succeeds. This module is NEVER imported by the test suite (the
// `inngest` package is ESM-only under Jest's CJS runtime) — tests use InMemoryDurableQueue instead.

import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'harvest-agent-runtime' });
