// T-R39 — proves the base identity-creation contract of POST /api/auth/register
// (src/app/api/auth/register/route.ts) that register-solution-number.test.ts (T-20) doesn't cover:
// the password is REAL bcrypt, never plaintext; a duplicate email is rejected; a breached password
// is rejected; and the response never echoes the password back. This is the route the newly-wired
// register wizard (src/app/auth/page.tsx) now actually calls — these are the guarantees that make
// "creates a real account with a hashed password" true, not just claimed.

import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

const createMock = jest.fn();
const findUniqueMock = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      create: (...a: unknown[]) => createMock(...a),
    },
  },
}));

const isBreachedMock = jest.fn(async (_password: string) => false);
jest.mock('@/services/security/credential-stuffing', () => ({
  getBreachedPasswordChecker: () => ({ isBreached: (password: string) => isBreachedMock(password) }),
}));

import { POST as register } from '@/app/api/auth/register/route';

const RAW_PASSWORD = 'A-Genuinely-Strong-Passw0rd!';

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
  isBreachedMock.mockReset();
  isBreachedMock.mockResolvedValue(false);
  findUniqueMock.mockResolvedValue(null);
  createMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'new-user-1',
    email: data.email,
    name: data.name,
    // R-07: the mock User row mirrors the route's write — it echoes back the persisted role,
    // which is now the resolved registration role (schema-default REP only when none is chosen).
    role: (data.role as string) ?? 'REP',
    org_type: data.org_type,
    access_tier: data.access_tier,
  }));
});

describe('POST /api/auth/register — real account creation (T-R39)', () => {
  test('creates a User with a REAL bcrypt hash — the raw password never appears in the stored value', async () => {
    const res = await post({ email: 'new@example.com', password: RAW_PASSWORD, name: 'New Rep' });
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);

    const stored = createMock.mock.calls[0][0].data.password_hash as string;
    expect(stored).not.toBe(RAW_PASSWORD);
    expect(stored).not.toContain(RAW_PASSWORD);
    expect(stored).toMatch(/^\$2[aby]\$\d{2}\$/); // a real bcrypt hash, not a plaintext placeholder
    await expect(bcrypt.compare(RAW_PASSWORD, stored)).resolves.toBe(true);
  });

  test('never writes a plaintext password field at all', async () => {
    await post({ email: 'new2@example.com', password: RAW_PASSWORD, name: 'New Rep 2' });
    const data = createMock.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.password).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain(RAW_PASSWORD);
  });

  test('the response body never echoes the password or its hash', async () => {
    const res = await post({ email: 'new3@example.com', password: RAW_PASSWORD, name: 'New Rep 3' });
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(RAW_PASSWORD);
    expect(serialized).not.toContain('password_hash');
    expect(serialized).not.toContain('password');
  });

  test('a duplicate email is REJECTED (409) and no second User row is created', async () => {
    findUniqueMock.mockResolvedValueOnce({ id: 'existing-user', email: 'taken@example.com' });
    const res = await post({ email: 'taken@example.com', password: RAW_PASSWORD, name: 'Someone Else' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already registered/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('a breached/weak password is REJECTED (400), fails closed before any row is created', async () => {
    isBreachedMock.mockResolvedValueOnce(true);
    const res = await post({ email: 'weak@example.com', password: 'password123', name: 'Weak Pw' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/breach/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  test.each([
    ['missing email', { password: RAW_PASSWORD, name: 'No Email' }],
    ['missing password', { email: 'nopass@example.com', name: 'No Pass' }],
    ['missing name', { email: 'noname@example.com', password: RAW_PASSWORD }],
  ])('%s is rejected (400) before any row is created', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('a registrant with no orgType defaults to EXTERNAL and REP role (schema default), never a self-elevated role', async () => {
    const res = await post({ email: 'plain@example.com', password: RAW_PASSWORD, name: 'Plain Rep' });
    expect(res.status).toBe(201);
    const data = createMock.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.org_type).toBe('EXTERNAL');
    expect(data.role).toBe('REP');
    const body = await res.json();
    expect(body.user.role).toBe('REP');
  });

  test('persists the submitted role: an RVP registrant is created as RVP, not schema-default REP (R-07)', async () => {
    const res = await post({ email: 'rvp@example.com', password: RAW_PASSWORD, name: 'RVP Person', role: 'RVP' });
    expect(res.status).toBe(201);
    const data = createMock.mock.calls[0][0].data as Record<string, unknown>;
    // R-07: the role the client submits is written to the User row — previously the route read no
    // `role` field at all and every registrant was silently created as REP (the operator selected
    // RVP in the demo and was stored as REP, blocking the RVP-specific onboarding behavior R-01).
    expect(data.role).toBe('RVP');
    const body = await res.json();
    expect(body.user.role).toBe('RVP');
  });

  test('persists UPLINE too — all three self-selectable §6.2 roles pass through', async () => {
    const res = await post({ email: 'up@example.com', password: RAW_PASSWORD, name: 'Up Person', role: 'UPLINE' });
    expect(res.status).toBe(201);
    const data = createMock.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.role).toBe('UPLINE');
    const body = await res.json();
    expect(body.user.role).toBe('UPLINE');
  });

  test('fails closed: an unrecognized/empty role value is stored as REP, never persisted raw or elevated (R-07)', async () => {
    for (const bogusRole of ['ADMIN', 'DUAL', 'SVP', '']) {
      const res = await post({ email: `bogus-${bogusRole || 'empty'}@example.com`, password: RAW_PASSWORD, name: 'Bogus Role', role: bogusRole });
      expect(res.status).toBe(201);
      const data = createMock.mock.calls[createMock.mock.calls.length - 1][0].data as Record<string, unknown>;
      expect(data.role).toBe('REP');
      const body = await res.json();
      expect(body.user.role).toBe('REP');
    }
  });
});
