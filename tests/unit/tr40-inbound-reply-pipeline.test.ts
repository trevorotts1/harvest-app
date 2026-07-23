// T-R40 (§7.5) — `POST /api/compliance/opt-out/inbound` is the ONLY inbound-message webhook in
// this codebase. Before this unit it handled STOP-keyword capture only: a normal (non-STOP) reply
// was a total no-op — no Contact lookup, no pipeline_stage write — so a contact could reply to a
// rep forever and never leave IDENTIFIED/INTRODUCED. This drives the REAL route handler (never
// PipelineService.advanceStage directly) with a real `hmacForMatch` (keyed by the test-seeded
// CONTACT_HASH_PEPPER, tests/jest.setup.ts) to prove the fix end-to-end.
//
// `@/lib/prisma` is mocked at the module boundary — the same convention tests/unit/
// compliance-routes-auth.test.ts already uses for this exact route — because the real Prisma
// client needs a live DB this suite does not have. `OptOutRegistryService` is NOT mocked: its real
// `recordInboundMessage` is exercised for real (a non-STOP body never touches optOutRegistry at
// all, so no mock is even needed for the happy path; the STOP-path test below supplies one).

import { NextRequest } from 'next/server';

interface MockContactRow {
  id: string;
  user_id: string;
  phone_hash: string | null;
  pipeline_stage: string;
  do_not_contact: boolean;
  last_contact_date: Date | null;
}

let contacts: MockContactRow[] = [];
const mockOptOutUpsert = jest.fn().mockResolvedValue({});

jest.mock('@/lib/prisma', () => ({
  prisma: {
    contact: {
      findMany: jest.fn(async ({ where }: { where: { phone_hash: string } }) =>
        contacts.filter((c) => c.phone_hash === where.phone_hash).map((c) => ({ ...c }))
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const c = contacts.find((x) => x.id === where.id);
        return c ? { ...c } : null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const c = contacts.find((x) => x.id === where.id);
        if (!c) throw new Error('not found');
        Object.assign(c, data);
        return { ...c };
      }),
    },
    optOutRegistry: {
      upsert: mockOptOutUpsert,
    },
  },
}));

// These MUST come after the jest.mock('@/lib/prisma', ...) call above: each transitively imports
// opt-out-registry.ts (or the route itself, which imports it), which imports `{ prisma }` from
// '@/lib/prisma' at module scope — importing any of them earlier would trigger that mock factory
// before `mockOptOutUpsert`'s `const` initializes (a ReferenceError, not a logic bug).
// eslint-disable-next-line import/first
import { PipelineStage } from '../../src/types/warm-market';
import { INBOUND_WEBHOOK_SECRET_ENV_VAR } from '../../src/services/compliance/opt-out/opt-out-registry';
import { agentKeyForPipelineStage } from '../../src/services/agent-runtime/scheduled-dispatch';
import { AgentKey } from '../../src/services/agent-runtime';
import { hmacForMatch } from '../../src/services/compliance/encryption/encryption';
import { POST as inboundPOST } from '../../src/app/api/compliance/opt-out/inbound/route';

const SECRET = 'tr40-test-secret';

function inboundRequest(from: string, body: string): NextRequest {
  return new NextRequest('http://localhost/api/compliance/opt-out/inbound', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-inbound-webhook-secret': SECRET },
    body: JSON.stringify({ from, body }),
  });
}

describe('T-R40: POST /api/compliance/opt-out/inbound advances the real pipeline on a genuine reply', () => {
  const ORIGINAL_ENV = process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR];

  beforeEach(() => {
    process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR] = SECRET;
    contacts = [
      { id: 'c-1', user_id: 'rep-1', phone_hash: null, pipeline_stage: PipelineStage.INTRODUCED, do_not_contact: false, last_contact_date: null },
    ];
    mockOptOutUpsert.mockClear();
  });

  afterAll(() => {
    if (ORIGINAL_ENV === undefined) delete process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR];
    else process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR] = ORIGINAL_ENV;
  });

  // hmacForMatch(phone) is deterministic under the test-seeded pepper — compute it via the SAME
  // real primitive the route uses, so the fixture's phone_hash genuinely matches.
  function phoneHashFor(phone: string): string {
    return hmacForMatch(phone);
  }

  test('a normal (non-STOP) inbound reply advances INTRODUCED -> RESPONDED and stamps last_contact_date', async () => {
    const phone = '+15551234567';
    contacts[0].phone_hash = phoneHashFor(phone);

    const res = await inboundPOST(inboundRequest(phone, "Yes I'd love to hear more!"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.optedOut).toBe(false);

    expect(contacts[0].pipeline_stage).toBe(PipelineStage.RESPONDED);
    expect(contacts[0].last_contact_date).not.toBeNull();
    expect(mockOptOutUpsert).not.toHaveBeenCalled(); // a real reply is never recorded as an opt-out
  });

  test('a STOP reply is NOT treated as a "responded" event — no pipeline advance, only the opt-out path fires', async () => {
    const phone = '+15559998888';
    contacts[0].phone_hash = phoneHashFor(phone);

    const res = await inboundPOST(inboundRequest(phone, 'STOP'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.optedOut).toBe(true);

    expect(contacts[0].pipeline_stage).toBe(PipelineStage.INTRODUCED); // unchanged
    expect(mockOptOutUpsert).toHaveBeenCalled();
  });

  test('a DO_NOT_CONTACT contact is never advanced even if they somehow reply', async () => {
    const phone = '+15550001111';
    contacts[0].phone_hash = phoneHashFor(phone);
    contacts[0].do_not_contact = true;

    await inboundPOST(inboundRequest(phone, 'please stop texting me forever'));

    expect(contacts[0].pipeline_stage).toBe(PipelineStage.INTRODUCED); // unchanged
  });

  test('IDEMPOTENCY: two replies in a row never thrash the stage or double-count', async () => {
    const phone = '+15552223333';
    contacts[0].phone_hash = phoneHashFor(phone);

    await inboundPOST(inboundRequest(phone, 'first reply'));
    const afterFirst = contacts[0].last_contact_date;
    expect(contacts[0].pipeline_stage).toBe(PipelineStage.RESPONDED);

    await inboundPOST(inboundRequest(phone, 'second reply, still RESPONDED'));
    expect(contacts[0].pipeline_stage).toBe(PipelineStage.RESPONDED); // no illegal re-jump
    expect(contacts[0].last_contact_date).toEqual(afterFirst); // no re-stamp on a no-op advance
  });

  // Proves the actual starvation this ticket exists to fix: RESPONDED feeds PRE_SALE_NURTURE
  // (scheduled-dispatch.ts's PIPELINE_STAGE_TO_AGENT), which — before this wiring — could never
  // receive a contact because nothing ever advanced a contact past IDENTIFIED/INTRODUCED for real.
  test('an advanced (RESPONDED) contact now routes to the nurture agent, not just PROSPECTING', async () => {
    const phone = '+15554445555';
    contacts[0].phone_hash = phoneHashFor(phone);

    await inboundPOST(inboundRequest(phone, 'tell me more'));

    expect(agentKeyForPipelineStage(contacts[0].pipeline_stage as PipelineStage)).toBe(AgentKey.PRE_SALE_NURTURE);
  });

  test('a reply from an unknown phone_hash (no matching contact) is a safe no-op — 200, no crash', async () => {
    const res = await inboundPOST(inboundRequest('+15559990000', 'hello?'));
    expect(res.status).toBe(200);
    // Only the seeded contact exists, with a different phone_hash — nothing should have moved.
    expect(contacts[0].pipeline_stage).toBe(PipelineStage.INTRODUCED);
  });
});
