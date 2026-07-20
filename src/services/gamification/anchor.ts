// T-43 (WP07) — reads the rep's own anchor statement for REP-FACING personalization (quotes,
// celebrations, notifications, the Goal Commitment Card — §12.1/§12.3/§12.4/§12.6/§12.8's "tied to
// the anchor statement").
//
// Master-spec §4.3: the anchor statement "may seed motivational surfaces but [is] never inserted
// into outbound content without `WhySession.use_in_outreach_consent = true`." Every use in THIS
// package is a motivational surface shown only to the rep who owns it (never a contact/public
// surface) — so, unlike `seven-whys/outreach-gate.ts` (which gates the OUTBOUND path and therefore
// checks `use_in_outreach_consent` first), this helper reads the anchor unconditionally. The content
// that gets BUILT from it (a quote, a celebration line, a notification body) still passes the CFE
// before the rep sees it, same as every other WP07 rep-facing surface (§0.4 rule 2) — CONSUMING
// WP01's existing decrypt utility (`decryptAnchorStatement`), never re-implementing it.

import { decryptAnchorStatement, getWhySessionEncryptionKey } from '@/services/onboarding/wp01/seven-whys/persistence';

export interface AnchorSourceClient {
  whySession: {
    findFirst(args: { where: { user_id: string }; orderBy?: Record<string, unknown> }): Promise<{ anchor_statement: string | null } | null>;
  };
}

/** Returns the rep's decrypted anchor statement, or `null` if they have none yet (pre-Seven-Whys, or
 *  the WHY_SESSION_ENCRYPTION_KEY is unset — fails soft here, never throws, since a missing anchor is
 *  a normal, designed empty state for every motivational surface, not a hold-worthy error). */
export async function readAnchorStatement(db: AnchorSourceClient, userId: string): Promise<string | null> {
  try {
    const row = await db.whySession.findFirst({ where: { user_id: userId }, orderBy: { created_at: 'desc' } });
    if (!row) return null;
    return decryptAnchorStatement(row as { anchor_statement: string | null }, getWhySessionEncryptionKey());
  } catch {
    return null;
  }
}
