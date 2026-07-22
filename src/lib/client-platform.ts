// T-58 — extracted from `src/app/api/contacts/import/route.ts`'s own (previously module-private)
// `resolveClientPlatform`, so `/api/onboarding/contacts-import`'s new native-contacts POST path (the
// real "Import from Phone" ingestion during onboarding) resolves the caller's declared platform the
// SAME way the general post-onboarding import route always has, rather than a second, hand-copied
// header/body-reading helper that could silently drift from it.
//
// Trust model (unchanged from the original): the caller self-declares its platform (native app shell
// vs. web) via either the `x-harvest-platform` header or a `clientPlatform` body field — this is NOT
// a cryptographic proof, the same posture `VaultService.assertModalityAllowed`'s own doc comment
// already states ("so the client surfaces the real fallback UX itself"). The real security property
// this buys is UX/data-integrity correctness (a source label that matches how the data was actually
// collected), not a hard trust boundary — the worst case of a forged declaration is a mislabeled
// `Contact.source`, never elevated data access (every route here still scopes strictly to the
// caller's OWN authenticated `userId`).

import type { NextRequest } from 'next/server';

import type { ClientPlatform } from '@/types/warm-market';

/** Resolves the caller's declared platform from either the request body's `clientPlatform` field or
 *  the `x-harvest-platform` header (body wins if both are present) — `undefined` for anything that
 *  isn't exactly `'web' | 'ios' | 'android'`, never a guess. */
export function resolveClientPlatform(
  req: NextRequest,
  body: { clientPlatform?: unknown }
): ClientPlatform | undefined {
  const header = req.headers.get('x-harvest-platform');
  const candidate = (typeof body.clientPlatform === 'string' ? body.clientPlatform : header) ?? undefined;
  if (candidate === 'web' || candidate === 'ios' || candidate === 'android') return candidate;
  return undefined;
}
