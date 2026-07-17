import { randomBytes } from 'crypto';

import { NextRequest } from 'next/server';

// A valid 32-byte base64 AES-256 key, test-only (generated so its byte length is guaranteed correct).
// Must be set BEFORE the register route runs so `getSolutionNumberEncryptionKey()` succeeds.
process.env.SOLUTION_NUMBER_ENCRYPTION_KEY =
  process.env.SOLUTION_NUMBER_ENCRYPTION_KEY || randomBytes(32).toString('base64');

// Mock the two external seams: the real DB and the breached-password checker. Registration logic
// (org gate, solution-number format check + encryption, tier assignment) runs for real.
const createMock = jest.fn();
const findUniqueMock = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUniqueMock(...a), create: (...a: unknown[]) => createMock(...a) } },
}));
jest.mock('@/services/security/credential-stuffing', () => ({
  getBreachedPasswordChecker: () => ({ isBreached: async () => false }),
}));

import { POST as register } from '@/app/api/auth/register/route';
import { decryptPII } from '@/services/compliance/encryption/encryption';

const RAW_SOLUTION_NUMBER = '1234567';

function post(body: Record<string, unknown>) {
  return register(
    new NextRequest('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  createMock.mockReset();
  findUniqueMock.mockReset();
  findUniqueMock.mockResolvedValue(null); // no existing user
  createMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'new-user-1',
    email: data.email,
    name: data.name,
    role: 'REP',
    org_type: data.org_type,
    access_tier: data.access_tier,
  }));
});

describe('POST /api/auth/register — solution number is 7-digit-checked AND encrypted at rest (T-20, §6.3/§6.10-4/§3.2)', () => {
  test('a Primerica registrant with a valid 7-digit number: stored value is ENCRYPTED, never the plaintext digits', async () => {
    const res = await post({
      email: 'p@example.com',
      password: 'A-Strong-Passw0rd!',
      name: 'Pat Rep',
      orgType: 'PRIMERICA',
      solutionNumber: RAW_SOLUTION_NUMBER,
    });
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);

    const stored = createMock.mock.calls[0][0].data.solution_number as string;
    // Not plaintext, and the raw digits do not appear anywhere in the stored envelope.
    expect(stored).not.toBe(RAW_SOLUTION_NUMBER);
    expect(stored).not.toContain(RAW_SOLUTION_NUMBER);

    // It IS a real encrypted envelope that decrypts back to the original with the at-rest key.
    const envelope = JSON.parse(stored);
    expect(envelope).toHaveProperty('ciphertext');
    expect(envelope).toHaveProperty('iv');
    expect(envelope).toHaveProperty('authTag');
    expect(envelope).not.toHaveProperty('key'); // a real server key is used, never a throwaway one
    const decrypted = decryptPII(envelope, process.env.SOLUTION_NUMBER_ENCRYPTION_KEY);
    expect(decrypted).toBe(RAW_SOLUTION_NUMBER);
  });

  test('the response body never echoes the solution number', async () => {
    const res = await post({
      email: 'p2@example.com',
      password: 'A-Strong-Passw0rd!',
      name: 'Pat Rep',
      orgType: 'PRIMERICA',
      solutionNumber: RAW_SOLUTION_NUMBER,
    });
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(RAW_SOLUTION_NUMBER);
  });

  test.each(['123456', '12345678', 'ABCDEFG', ''])(
    'a mis-formatted / missing solution number (%p) is REJECTED with 400 (7-digit format check, not presence-only)',
    async (bad) => {
      const res = await post({
        email: `bad-${bad || 'empty'}@example.com`,
        password: 'A-Strong-Passw0rd!',
        name: 'Pat Rep',
        orgType: 'PRIMERICA',
        solutionNumber: bad,
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/7 digits/i);
      expect(createMock).not.toHaveBeenCalled();
    }
  );

  test('a non-Primerica (EXTERNAL) registrant stores no solution number at all', async () => {
    const res = await post({
      email: 'ext@example.com',
      password: 'A-Strong-Passw0rd!',
      name: 'Ext Rep',
      orgType: 'EXTERNAL',
      solutionNumber: RAW_SOLUTION_NUMBER, // even if supplied, EXTERNAL has no such field
    });
    expect(res.status).toBe(201);
    expect(createMock.mock.calls[0][0].data.solution_number).toBeNull();
  });
});
