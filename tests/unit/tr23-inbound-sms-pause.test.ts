// T-R23 (WP05 §10.8 LAUNCH-GATE closure) — POST /api/messaging/inbound. Before this unit,
// `SequenceService.pauseOnReply` (src/services/messaging/sequence/sequence.service.ts) had NO live
// caller anywhere in the build (see that file's own tests, which only drive the service directly).
// This suite drives the REAL route handler (never `SequenceService.pauseOnReply` directly) with a
// REAL, hand-rolled `X-Twilio-Signature` (Twilio's own documented HMAC-SHA1-over-URL+sorted-params
// scheme — the same algorithm src/services/messaging/send/twilio-signature.ts implements) to prove
// the fail-closed signature gate AND the pauseOnReply wiring end to end.
//
// `@/lib/prisma` is mocked at the module boundary (same convention as tests/unit/
// tr40-inbound-reply-pipeline.test.ts, which drives the sibling `/api/compliance/opt-out/inbound`
// webhook). `OptOutRegistryService` and `buildSequenceService` are mocked too — this suite is a
// pure route/signature-gating + wiring test; `OptOutRegistryService.recordInboundMessage`'s own STOP-
// keyword logic is already proven in opt-out-registry.test.ts, and `SequenceService.pauseOnReply`'s
// own PAUSE semantics are already proven in sequence.service.test.ts. `hmacForMatch`/`toE164` are the
// REAL primitives (keyed by the test-seeded CONTACT_HASH_PEPPER, tests/jest.setup.ts) so the
// fixtures' `phone_hash` genuinely matches what the route computes from an inbound `From`.

import { createHmac } from 'node:crypto';

import { MessageChannel } from '@prisma/client';
import { NextRequest } from 'next/server';

interface MockContactRow {
  id: string;
  user_id: string;
  phone_hash: string | null;
}
interface MockSequenceRow {
  id: string;
  contact_id: string;
  state: string;
}

let contacts: MockContactRow[] = [];
let sequences: MockSequenceRow[] = [];

const mockContactFindMany = jest.fn(async ({ where }: { where: { phone_hash: string | { in: string[] } } }) => {
  // The route now looks up by `phone_hash IN {candidate hashes}` (T-R23 QC fix #1); still tolerate a
  // bare-string clause so this mock stays faithful to Prisma's accepted shapes.
  const clause = where.phone_hash;
  const hashes = typeof clause === 'string' ? [clause] : clause.in;
  return contacts.filter((c) => c.phone_hash != null && hashes.includes(c.phone_hash)).map((c) => ({ ...c }));
});
const mockSequenceFindMany = jest.fn(
  async ({ where }: { where: { contact_id: string; state: string } }) =>
    sequences
      .filter((s) => s.contact_id === where.contact_id && s.state === where.state)
      .map((s) => ({ ...s }))
);

jest.mock('@/lib/prisma', () => ({
  prisma: {
    contact: { findMany: mockContactFindMany },
    outreachSequence: { findMany: mockSequenceFindMany },
  },
}));

const mockRecordInboundMessage = jest.fn();
jest.mock('@/services/compliance/opt-out/opt-out-registry', () => ({
  OptOutRegistryService: jest.fn().mockImplementation(() => ({
    recordInboundMessage: mockRecordInboundMessage,
  })),
}));

const mockPauseOnReply = jest.fn();
jest.mock('@/services/messaging/send/production-wiring', () => ({
  buildSequenceService: jest.fn(() => ({ pauseOnReply: mockPauseOnReply })),
}));

// These MUST come after the jest.mock(...) calls above — same reason tr40-inbound-reply-pipeline.
// test.ts documents: each transitively imports a module that reads `{ prisma }` from '@/lib/prisma'
// (or the mocked services) at module scope.
// eslint-disable-next-line import/first
import { TWILIO_AUTH_TOKEN_ENV_VAR } from '@/services/deliverability/twilio-client';
import { hmacForMatch } from '@/services/compliance/encryption/encryption';
import { POST as inboundPOST } from '@/app/api/messaging/inbound/route';

const TWILIO_TOKEN = 'tr23-test-twilio-auth-token';
// T-R23 QC fix #3: the route reconstructs the signed URL from the CONFIGURED public origin
// (NEXTAUTH_URL) + the request path — not req.url. So the signature must be computed over
// `${PUBLIC_ORIGIN}${ROUTE_PATH}`, and the test seeds NEXTAUTH_URL to PUBLIC_ORIGIN (beforeEach).
const PUBLIC_ORIGIN = 'http://localhost';
const ROUTE_PATH = '/api/messaging/inbound';
const ROUTE_URL = `${PUBLIC_ORIGIN}${ROUTE_PATH}`;

/** Twilio's own documented request-signing algorithm, reimplemented independently here (not by
 *  calling the route's own verify function) so this suite genuinely proves spec-conformance rather
 *  than self-agreement. */
function computeSignature(url: string, params: Record<string, string>, token: string = TWILIO_TOKEN): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  return createHmac('sha1', token).update(data, 'utf8').digest('base64');
}

/** `signature`: omitted -> a correct signature is computed and attached; `null` -> the header is
 *  omitted entirely; a string -> that exact (possibly forged) value is attached. */
function inboundRequest(params: Record<string, string>, signature?: string | null): NextRequest {
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (signature !== null) {
    headers['x-twilio-signature'] = signature ?? computeSignature(ROUTE_URL, params);
  }
  return new NextRequest(ROUTE_URL, { method: 'POST', headers, body });
}

function phoneHashFor(phone: string): string {
  // The VAULT's REAL stored-hash convention (src/services/warm-market/vault/vault.service.ts
  // `upsertRow`: `hmacForMatch(phone.replace(/\D/g,''))`) — digits only, NO leading '+', no country-
  // code logic. Seeding fixtures with the route's own (pre-fix) `hmacForMatch(toE164(...))` is exactly
  // the false-green that let the phone_hash-mismatch bug pass QC; this now matches production.
  return hmacForMatch(phone.replace(/\D/g, ''));
}

describe('POST /api/messaging/inbound — T-R23: real Twilio-signed inbound-SMS webhook -> SequenceService.pauseOnReply', () => {
  const ORIGINAL_TOKEN = process.env[TWILIO_AUTH_TOKEN_ENV_VAR];
  const ORIGINAL_ORIGIN = process.env.NEXTAUTH_URL;

  beforeEach(() => {
    process.env[TWILIO_AUTH_TOKEN_ENV_VAR] = TWILIO_TOKEN;
    process.env.NEXTAUTH_URL = PUBLIC_ORIGIN; // T-R23 QC fix #3 — the configured public origin.
    contacts = [];
    sequences = [];
    mockRecordInboundMessage.mockReset().mockResolvedValue(false);
    mockPauseOnReply.mockReset().mockImplementation(async (userId: string, sequenceId: string) => ({
      id: sequenceId,
      user_id: userId,
      contact_id: 'irrelevant-for-this-suite',
      sequence_type: 'STANDARD',
      state: 'PAUSED',
      pause_reason: 'REPLY',
      current_step_index: 0,
      started_at: new Date(),
      updated_at: new Date(),
    }));
    mockContactFindMany.mockClear();
    mockSequenceFindMany.mockClear();
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env[TWILIO_AUTH_TOKEN_ENV_VAR];
    else process.env[TWILIO_AUTH_TOKEN_ENV_VAR] = ORIGINAL_TOKEN;
    if (ORIGINAL_ORIGIN === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = ORIGINAL_ORIGIN;
  });

  test('FAILS CLOSED when TWILIO_AUTH_TOKEN is unconfigured — 401, nothing touched (config error, not a pass)', async () => {
    delete process.env[TWILIO_AUTH_TOKEN_ENV_VAR];
    const phone = '+15551110000';
    contacts = [{ id: 'c-1', user_id: 'rep-1', phone_hash: phoneHashFor(phone) }];
    sequences = [{ id: 'seq-1', contact_id: 'c-1', state: 'ACTIVE' }];

    const req = inboundRequest({ From: phone, To: '+15550000001', Body: 'hi', MessageSid: 'SM1' });
    const res = await inboundPOST(req);

    expect(res.status).toBe(401);
    expect(mockRecordInboundMessage).not.toHaveBeenCalled();
    expect(mockPauseOnReply).not.toHaveBeenCalled();
    expect(mockContactFindMany).not.toHaveBeenCalled();
  });

  test('FAILS CLOSED when NEXTAUTH_URL (public origin) is unconfigured — 401, nothing processed (QC fix #3)', async () => {
    delete process.env.NEXTAUTH_URL;
    const phone = '+15551110010';
    contacts = [{ id: 'c-1', user_id: 'rep-1', phone_hash: phoneHashFor(phone) }];
    sequences = [{ id: 'seq-1', contact_id: 'c-1', state: 'ACTIVE' }];

    const req = inboundRequest({ From: phone, To: '+15550000001', Body: 'hi', MessageSid: 'SM11' });
    const res = await inboundPOST(req);

    expect(res.status).toBe(401);
    expect(mockRecordInboundMessage).not.toHaveBeenCalled();
    expect(mockPauseOnReply).not.toHaveBeenCalled();
    expect(mockContactFindMany).not.toHaveBeenCalled();
  });

  test('REJECTS a missing X-Twilio-Signature header — 403/401 range rejection, pauseOnReply NOT called', async () => {
    const phone = '+15551110001';
    contacts = [{ id: 'c-1', user_id: 'rep-1', phone_hash: phoneHashFor(phone) }];
    sequences = [{ id: 'seq-1', contact_id: 'c-1', state: 'ACTIVE' }];

    const req = inboundRequest({ From: phone, To: '+15550000001', Body: 'hi', MessageSid: 'SM2' }, null);
    const res = await inboundPOST(req);

    expect(res.status).toBe(403);
    expect(mockRecordInboundMessage).not.toHaveBeenCalled();
    expect(mockPauseOnReply).not.toHaveBeenCalled();
  });

  test('REJECTS a forged/invalid X-Twilio-Signature — rejected, pauseOnReply NOT called, never processed', async () => {
    const phone = '+15551110002';
    contacts = [{ id: 'c-1', user_id: 'rep-1', phone_hash: phoneHashFor(phone) }];
    sequences = [{ id: 'seq-1', contact_id: 'c-1', state: 'ACTIVE' }];

    const req = inboundRequest(
      { From: phone, To: '+15550000001', Body: 'hi', MessageSid: 'SM3' },
      'dGhpcyBpcyBhIGZvcmdlZCBzaWduYXR1cmU='
    );
    const res = await inboundPOST(req);

    expect(res.status).toBe(403);
    expect(mockRecordInboundMessage).not.toHaveBeenCalled();
    expect(mockPauseOnReply).not.toHaveBeenCalled();
  });

  test('REJECTS a tampered body (signature no longer matches the params) even with a well-formed header', async () => {
    const phone = '+15551110009';
    const signedParams = { From: phone, To: '+15550000001', Body: 'original', MessageSid: 'SM3b' };
    const validSig = computeSignature(ROUTE_URL, signedParams);
    const tamperedParams = { ...signedParams, Body: 'tampered!' };

    const body = new URLSearchParams(tamperedParams).toString();
    const req = new NextRequest(ROUTE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': validSig },
      body,
    });
    const res = await inboundPOST(req);

    expect(res.status).toBe(403);
    expect(mockPauseOnReply).not.toHaveBeenCalled();
  });

  test('a valid signed inbound reply from a known contact with an ACTIVE sequence pauses it via pauseOnReply', async () => {
    const phone = '+15551110003';
    contacts = [{ id: 'c-1', user_id: 'rep-1', phone_hash: phoneHashFor(phone) }];
    sequences = [{ id: 'seq-1', contact_id: 'c-1', state: 'ACTIVE' }];

    const req = inboundRequest({
      From: phone,
      To: '+15550000001',
      Body: 'Sounds great, tell me more!',
      MessageSid: 'SM4',
    });
    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('xml');
    expect(mockRecordInboundMessage).toHaveBeenCalledWith(
      phoneHashFor(phone),
      MessageChannel.SMS_PLATFORM,
      'Sounds great, tell me more!'
    );
    expect(mockPauseOnReply).toHaveBeenCalledTimes(1);
    expect(mockPauseOnReply).toHaveBeenCalledWith('rep-1', 'seq-1');
  });

  test('REGRESSION (write/read convention, QC fix #1): a contact stored by the VAULT as a 10-digit hash IS matched by an 11-digit E.164 Twilio From', async () => {
    // The rep imported "(555) 777-8888" — the vault stored `hmacForMatch("5557778888")` (10 digits,
    // no country code, no '+'). Twilio delivers the reply as the 11-digit E.164 "+15557778888".
    // Pre-fix, the route hashed `hmacForMatch(toE164("+15557778888")) = hmacForMatch("+15557778888")`,
    // which never equals the stored 10-digit hash → the contact was never found, pauseOnReply never
    // fired, and (worse) a STOP would have been recorded under a hash the outbound gate never checks.
    // This test seeds the REAL vault hash and asserts the fixed route's candidate-hash lookup matches.
    const vaultStoredHash = hmacForMatch('(555) 777-8888'.replace(/\D/g, '')); // === hmacForMatch('5557778888')
    contacts = [{ id: 'c-1', user_id: 'rep-1', phone_hash: vaultStoredHash }];
    sequences = [{ id: 'seq-1', contact_id: 'c-1', state: 'ACTIVE' }];

    const req = inboundRequest({ From: '+15557778888', To: '+15550000001', Body: 'yes, tell me more', MessageSid: 'SM-REG' });
    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockPauseOnReply).toHaveBeenCalledTimes(1);
    expect(mockPauseOnReply).toHaveBeenCalledWith('rep-1', 'seq-1');
  });

  test('cross-rep fan-out: the same phone_hash matching contacts in TWO reps pipelines pauses BOTH', async () => {
    const phone = '+15551110004';
    contacts = [
      { id: 'c-1', user_id: 'rep-1', phone_hash: phoneHashFor(phone) },
      { id: 'c-2', user_id: 'rep-2', phone_hash: phoneHashFor(phone) },
    ];
    sequences = [
      { id: 'seq-1', contact_id: 'c-1', state: 'ACTIVE' },
      { id: 'seq-2', contact_id: 'c-2', state: 'ACTIVE' },
    ];

    const req = inboundRequest({ From: phone, To: '+15550000001', Body: 'ok', MessageSid: 'SM5' });
    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockPauseOnReply).toHaveBeenCalledTimes(2);
    expect(mockPauseOnReply).toHaveBeenCalledWith('rep-1', 'seq-1');
    expect(mockPauseOnReply).toHaveBeenCalledWith('rep-2', 'seq-2');
  });

  test('a contact with only a COMPLETED sequence (no ACTIVE one) never calls pauseOnReply', async () => {
    const phone = '+15551110005';
    contacts = [{ id: 'c-1', user_id: 'rep-1', phone_hash: phoneHashFor(phone) }];
    sequences = [{ id: 'seq-1', contact_id: 'c-1', state: 'COMPLETED' }];

    const req = inboundRequest({ From: phone, To: '+15550000001', Body: 'thanks', MessageSid: 'SM6' });
    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockPauseOnReply).not.toHaveBeenCalled();
  });

  test('an unknown sender (no matching contact) is a safe no-op — 200, no crash, pauseOnReply not called', async () => {
    const req = inboundRequest({ From: '+15559990000', To: '+15550000001', Body: 'hello?', MessageSid: 'SM7' });
    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockPauseOnReply).not.toHaveBeenCalled();
    expect(mockSequenceFindMany).not.toHaveBeenCalled();
  });

  test('a STOP/opt-out keyword routes through the EXISTING opt-out path and never touches sequences (no duplicate STOP logic)', async () => {
    const phone = '+15551110006';
    contacts = [{ id: 'c-1', user_id: 'rep-1', phone_hash: phoneHashFor(phone) }];
    sequences = [{ id: 'seq-1', contact_id: 'c-1', state: 'ACTIVE' }];
    mockRecordInboundMessage.mockResolvedValue(true); // the existing opt-out path recognized STOP

    const req = inboundRequest({ From: phone, To: '+15550000001', Body: 'STOP', MessageSid: 'SM8' });
    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockRecordInboundMessage).toHaveBeenCalledWith(phoneHashFor(phone), MessageChannel.SMS_PLATFORM, 'STOP');
    expect(mockPauseOnReply).not.toHaveBeenCalled();
    expect(mockSequenceFindMany).not.toHaveBeenCalled(); // opt-out short-circuits before any sequence lookup
  });

  test('pauseOnReply throwing for one sequence is handled — no unhandled throw, benign 200, no unintended outbound', async () => {
    const phone = '+15551110007';
    contacts = [{ id: 'c-1', user_id: 'rep-1', phone_hash: phoneHashFor(phone) }];
    sequences = [{ id: 'seq-1', contact_id: 'c-1', state: 'ACTIVE' }];
    mockPauseOnReply.mockReset().mockRejectedValue(new Error('simulated DB write failure'));

    const req = inboundRequest({ From: phone, To: '+15550000001', Body: 'reply', MessageSid: 'SM9' });
    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockPauseOnReply).toHaveBeenCalledTimes(1);
  });

  test('a sequence-lookup error for a matched contact is handled — no unhandled throw, benign 200 ack', async () => {
    const phone = '+15551110008';
    contacts = [{ id: 'c-1', user_id: 'rep-1', phone_hash: phoneHashFor(phone) }];
    mockSequenceFindMany.mockRejectedValueOnce(new Error('simulated connection reset'));

    const req = inboundRequest({ From: phone, To: '+15550000001', Body: 'reply', MessageSid: 'SM10' });
    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockPauseOnReply).not.toHaveBeenCalled();
  });
});
