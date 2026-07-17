// WP01 §6.10-10 (T-21R) — GDPR consent grant/revoke wired onto WP11's `ConsentManager` + the durable
// `ComplianceConsent`/`User` Prisma models. Uses a plain mock Prisma-shaped client (the same
// DI-mockable pattern as `tests/unit/wp01-onboarding-gate.test.ts` / seven-whys persistence tests) —
// no real database — while calling the REAL `ConsentManager` class (imported straight from WP11's own
// module, never re-implemented here) for the versioning/timestamping decision.
//
// PROOF (a): granting consent writes a versioned/timestamped ComplianceConsent record via
// ConsentManager AND sets User.gdpr_consent = true.
// PROOF (c): consent is revocable — the revoke path records the revocation (a NEW row, given: false)
// and clears User.gdpr_consent.

import {
  GDPR_COMPLIANCE_CONSENT_TYPE,
  GDPR_WP11_CONSENT_TYPE,
  grantGdprConsent,
  revokeGdprConsent,
  type ComplianceConsentRow,
  type GdprConsentPrismaClient,
} from '../../src/lib/onboarding/gdpr-consent';

function makeMockClient() {
  const complianceConsentRows: ComplianceConsentRow[] = [];
  const userUpdates: { id: string; gdpr_consent: boolean }[] = [];
  let nextId = 0;

  const client: GdprConsentPrismaClient = {
    complianceConsent: {
      create: jest.fn(async ({ data }) => {
        const row: ComplianceConsentRow = { id: `cc-${nextId++}`, ...data };
        complianceConsentRows.push(row);
        return row;
      }),
    },
    user: {
      update: jest.fn(async ({ where, data }) => {
        const update = { id: where.id, gdpr_consent: data.gdpr_consent };
        userUpdates.push(update);
        return update;
      }),
    },
  };

  return { client, complianceConsentRows, userUpdates };
}

describe('grantGdprConsent (§6.10-10, PROOF a)', () => {
  test('writes a NEW, timestamped ComplianceConsent row (consent_type "gdpr", given: true) via WP11 ConsentManager, AND sets User.gdpr_consent = true', async () => {
    const { client, complianceConsentRows, userUpdates } = makeMockClient();

    const result = await grantGdprConsent('user-abc', {}, client);

    // The WP11 ConsentManager record — versioned + timestamped, real class, real method.
    expect(result.record.given).toBe(true);
    expect(result.record.version).toBe(1);
    expect(result.record.consent_type).toBe(GDPR_WP11_CONSENT_TYPE);
    expect(typeof result.record.timestamp).toBe('string');
    expect(new Date(result.record.timestamp).toString()).not.toBe('Invalid Date');

    // The durable ComplianceConsent row this module additionally persists.
    expect(complianceConsentRows).toHaveLength(1);
    expect(complianceConsentRows[0]).toMatchObject({
      user_id: 'user-abc',
      consent_type: GDPR_COMPLIANCE_CONSENT_TYPE,
      given: true,
    });
    expect(complianceConsentRows[0]!.timestamp).toBeInstanceOf(Date);

    // User.gdpr_consent flipped true.
    expect(userUpdates).toEqual([{ id: 'user-abc', gdpr_consent: true }]);

    // TEETH: client.complianceConsent.create and client.user.update were both actually invoked — if
    // this function were changed to only call ConsentManager and never touch Prisma at all (the exact
    // pre-fix gap: "no route ever sets User.gdpr_consent = true"), these would be zero calls.
    expect(client.complianceConsent.create).toHaveBeenCalledTimes(1);
    expect(client.user.update).toHaveBeenCalledTimes(1);
  });

  test('a SECOND grant for the SAME user increments the WP11 ConsentManager version (2, not 1) — proves the versioning is real, not hardcoded', async () => {
    const { client } = makeMockClient();

    const first = await grantGdprConsent('user-versioning', {}, client);
    expect(first.record.version).toBe(1);

    const second = await grantGdprConsent('user-versioning', {}, client);
    expect(second.record.version).toBe(2);
  });

  test('passes source/ipAddress through to the WP11 record (metadata plumbing is real, not dropped)', async () => {
    const { client } = makeMockClient();

    const result = await grantGdprConsent(
      'user-with-ip',
      { source: 'onboarding', ipAddress: '203.0.113.9' },
      client
    );

    expect(result.record.source).toBe('onboarding');
    expect(result.record.ip_address).toBe('203.0.113.9');
    expect(result.record.metadata).toMatchObject({ regulation: 'GDPR' });
  });
});

describe('revokeGdprConsent (§6.10-10, PROOF c: revocable)', () => {
  test('a revoke AFTER a grant writes a NEW ComplianceConsent row (given: false) and clears User.gdpr_consent', async () => {
    const { client, complianceConsentRows, userUpdates } = makeMockClient();

    await grantGdprConsent('user-revoke-flow', {}, client);
    const revokeResult = await revokeGdprConsent('user-revoke-flow', {}, client);

    expect(revokeResult.record.given).toBe(false);
    // The revoke is version 2 (grant was version 1) — a NEW record, not an in-place mutation.
    expect(revokeResult.record.version).toBe(2);

    expect(complianceConsentRows).toHaveLength(2);
    expect(complianceConsentRows[1]).toMatchObject({
      user_id: 'user-revoke-flow',
      consent_type: GDPR_COMPLIANCE_CONSENT_TYPE,
      given: false,
    });

    // Both the grant (true) and the revoke (false) User updates happened, in order.
    expect(userUpdates).toEqual([
      { id: 'user-revoke-flow', gdpr_consent: true },
      { id: 'user-revoke-flow', gdpr_consent: false },
    ]);
  });

  test('revoking without a prior grant still records a revocation event (version 1, given: false) — never throws', async () => {
    const { client, complianceConsentRows } = makeMockClient();

    const result = await revokeGdprConsent('user-never-granted', {}, client);

    expect(result.record.given).toBe(false);
    expect(complianceConsentRows[0]).toMatchObject({ given: false, consent_type: GDPR_COMPLIANCE_CONSENT_TYPE });
  });

  // TEETH: if `revokeGdprConsent` were changed to only call ConsentManager (never Prisma), this
  // would be zero calls — the exact "revocable in-memory only, never durable" regression this guards.
  test('TEETH: revoke actually calls Prisma — not just the in-memory ConsentManager', async () => {
    const { client } = makeMockClient();
    await revokeGdprConsent('user-teeth', {}, client);
    expect(client.complianceConsent.create).toHaveBeenCalledTimes(1);
    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: 'user-teeth' },
      data: { gdpr_consent: false },
    });
  });
});
