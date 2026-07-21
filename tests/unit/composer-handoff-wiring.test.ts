// T-57 R3a — proves the Composer Handoff Sheet is actually WIRED from all three required entry
// points (the reachability half of BLOCKER-C2/E2/D1 + M8), and that the contactId→draftId resolver
// the two contactId-only entry points depend on picks the right APPROVED own-number draft off the
// REAL Approval Inbox list route. The wiring assertions are structural (source-scan) because the two
// page components fetch their own data in `useEffect` (which never runs in this repo's node/no-jsdom
// render) — a source-scan is the deterministic proof that the trigger + sheet are mounted and fed
// the right ids, mirroring conversation-mount.test.ts's structural mounting proof.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveFirstTouchDraftId } from '@/app/community/components/resolve-first-touch-draft';

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

describe('Entry point 1 — Approval Inbox: own-number first-touch approve-success chains into the sheet (AC-5.6-6)', () => {
  const src = read('app/inbox/page.tsx');
  test('imports and mounts ComposerHandoffSheet', () => {
    expect(src).toMatch(/import ComposerHandoffSheet from '@\/app\/community\/components\/ComposerHandoffSheet'/);
    expect(src).toMatch(/<ComposerHandoffSheet/);
  });
  test('opens it ONLY for an own-number (SMS_HANDOFF) item, on approve success', () => {
    expect(src).toContain("approvedItem.channel === 'SMS_HANDOFF'");
    expect(src).toMatch(/setComposerFor\(/);
    // it passes the approved draft's own id as the draftId
    expect(src).toMatch(/setComposerFor\(\{ draftId, contactName/);
  });
});

describe('Entry point 2 — First-48 goal cards: one-tap "contact now" (M8, §12.2)', () => {
  const src = read('app/today/components/WP07Panel.tsx');
  test('imports the sheet + the draft resolver and mounts the sheet', () => {
    expect(src).toMatch(/import ComposerHandoffSheet from '@\/app\/community\/components\/ComposerHandoffSheet'/);
    expect(src).toMatch(/resolveFirstTouchDraftId/);
    expect(src).toMatch(/<ComposerHandoffSheet/);
  });
  test('a "contact now" affordance per goal resolves the draft then opens the sheet', () => {
    expect(src).toMatch(/first48\.contactNow/);
    expect(src).toMatch(/handleContactNow/);
    expect(src).toMatch(/resolveFirstTouchDraftId\(goal\.contactId\)/);
  });
});

describe('Entry point 3 — Contact detail: fresh first touch (§5.7)', () => {
  const src = read('app/community/[contactId]/page.tsx');
  test('imports the sheet + resolver and mounts the sheet', () => {
    expect(src).toMatch(/import ComposerHandoffSheet from '\.\.\/components\/ComposerHandoffSheet'/);
    expect(src).toMatch(/resolveFirstTouchDraftId/);
    expect(src).toMatch(/<ComposerHandoffSheet/);
  });
  test('a "send your first hello" trigger resolves the draft then opens the sheet', () => {
    expect(src).toMatch(/composer\.startFirstTouch/);
    expect(src).toMatch(/handleStartFirstTouch/);
    expect(src).toMatch(/resolveFirstTouchDraftId\(contact\.id\)/);
  });
});

describe('resolveFirstTouchDraftId — picks the APPROVED own-number draft off the real inbox route', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function stubInbox(items: unknown[], ok = true) {
    global.fetch = (async (url: string) => {
      expect(String(url)).toContain('/api/approval-inbox?state=APPROVED');
      return { ok, json: async () => ({ items }) } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  test('returns the most-recent APPROVED SMS_HANDOFF draft for the contact', async () => {
    stubInbox([
      { id: 'old', contact_id: 'c-1', channel: 'SMS_HANDOFF', approval_state: 'APPROVED', created_at: '2026-07-01T00:00:00Z' },
      { id: 'new', contact_id: 'c-1', channel: 'SMS_HANDOFF', approval_state: 'APPROVED', created_at: '2026-07-10T00:00:00Z' },
      { id: 'other-contact', contact_id: 'c-2', channel: 'SMS_HANDOFF', approval_state: 'APPROVED', created_at: '2026-07-20T00:00:00Z' },
      { id: 'platform', contact_id: 'c-1', channel: 'SMS_PLATFORM', approval_state: 'APPROVED', created_at: '2026-07-20T00:00:00Z' },
    ]);
    await expect(resolveFirstTouchDraftId('c-1')).resolves.toBe('new');
  });

  test('returns null when the only matching draft is NOT approved (so the entry point shows "not ready")', async () => {
    stubInbox([{ id: 'pending', contact_id: 'c-1', channel: 'SMS_HANDOFF', approval_state: 'PENDING', created_at: '2026-07-10T00:00:00Z' }]);
    await expect(resolveFirstTouchDraftId('c-1')).resolves.toBeNull();
  });

  test('returns null (never throws) when the inbox route errors', async () => {
    stubInbox([], false);
    await expect(resolveFirstTouchDraftId('c-1')).resolves.toBeNull();
  });
});
