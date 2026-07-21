// T-57 R3a — resolve the first-touch DraftMessage id for a contact from the REAL Approval Inbox
// list route (`GET /api/approval-inbox?state=APPROVED`). The composer handoff route
// (`POST /api/messaging/compose-handoff`) needs a `draftId`, but the contactId-only entry points
// (First-48 goal cards §12.2/M8, contact-detail fresh first touch §5.7) don't carry one — this
// finds it. Deliberately returns ONLY an APPROVED own-number (SMS_HANDOFF) draft: the composer
// service produces sendable text only for a CFE-cleared AND human-approved draft, so a
// not-yet-approved draft would just fail-closed to a hold — surfacing "not ready, check Approvals"
// at the entry point is the honest, clearer path. `null` = nothing approved to hand off yet.

interface InboxDraftRow {
  id: string;
  contact_id: string;
  channel: string;
  approval_state: string;
  created_at: string;
}

export async function resolveFirstTouchDraftId(contactId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/approval-inbox?state=APPROVED');
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: InboxDraftRow[] };
    const matches = (body.items ?? []).filter(
      (it) => it.channel === 'SMS_HANDOFF' && it.contact_id === contactId && it.approval_state === 'APPROVED'
    );
    if (matches.length === 0) return null;
    // Most-recently-created approved first touch wins.
    matches.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return matches[0].id;
  } catch {
    return null;
  }
}
