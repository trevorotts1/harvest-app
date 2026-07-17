// In-memory test seam for the `/api/onboarding/complete` route (T-19 QC fix).
//
// Kept in its own module — NOT exported from `route.ts` — because Next.js's typed-routes
// typecheck restricts a route file's exports to the known HTTP-verb/route-config identifiers only
// (`POST`, `GET`, `dynamic`, etc.); any other export fails `tsc` against the generated
// `.next/types/app/**/route.ts` (see the analogous "not exported to avoid Next.js route type
// pollution" comment in `../status/route.ts`, which predates this fix). This scaffold has no
// session-creation endpoint of its own yet (full onboarding-session lifecycle wiring is T-20), so a
// regression test asserting the LIVE route's tier-assignment behavior needs a seam to plant a fake
// session/user directly — importing this module (not the route module) gives it exactly that,
// while `route.ts` itself stays a Next.js-typecheck-clean route file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sessions: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const users: any[] = [];
