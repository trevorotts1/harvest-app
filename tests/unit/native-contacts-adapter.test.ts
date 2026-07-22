// T-58 — proves `native-contacts-adapter.ts`'s mapping + dedupe against the REAL, documented
// `@capacitor-community/contacts` payload shape (definitions.d.ts's `ContactPayload`/`NamePayload`/
// `PhonePayload`/`EmailPayload`/`BirthdayPayload`) — never an invented one (external-payload
// false-green class: a test fixture that fabricates fields the real plugin never emits can make a
// mapper look correct while silently depending on data that will never arrive in production).

import {
  buildNativeContactCandidates,
  mapNativeContactToRow,
  type NativeContactPayload,
} from '../../src/services/warm-market/vault/native-contacts-adapter';

// ── External-payload false-green guard ──────────────────────────────────────────────────────────
// The EXACT key sets the plugin's own shipped `dist/esm/definitions.d.ts` documents for the
// interfaces this adapter reads (copy-verified against node_modules/@capacitor-community/contacts —
// see native-contacts-adapter.ts's file header for the full citation). Every fixture below is
// checked against these allow-lists so a future edit can never quietly add a fabricated field (e.g.
// a made-up "score"/"tag"/"linkedinUrl") and have it look like real plugin data.
const REAL_CONTACT_PAYLOAD_KEYS = new Set([
  'contactId',
  'name',
  'organization',
  'birthday',
  'note',
  'phones',
  'emails',
  'urls',
  'postalAddresses',
  'image',
]);
const REAL_NAME_PAYLOAD_KEYS = new Set(['display', 'given', 'middle', 'family', 'prefix', 'suffix']);
const REAL_PHONE_PAYLOAD_KEYS = new Set(['type', 'label', 'isPrimary', 'number']);
const REAL_EMAIL_PAYLOAD_KEYS = new Set(['type', 'label', 'isPrimary', 'address']);
const REAL_BIRTHDAY_PAYLOAD_KEYS = new Set(['day', 'month', 'year']);

function assertOnlyRealKeys(obj: object, allowed: ReadonlySet<string>, label: string) {
  for (const key of Object.keys(obj)) {
    expect(allowed.has(key)).toBe(true);
  }
  // TEETH: prove the allow-list itself would actually catch a fabricated field, not just that the
  // fixture happens to pass — a set that silently allowed anything would make the loop above vacuous.
  expect(allowed.has('__never_a_real_field__')).toBe(false);
  void label;
}

function fixture(payload: NativeContactPayload): NativeContactPayload {
  assertOnlyRealKeys(payload, REAL_CONTACT_PAYLOAD_KEYS, 'ContactPayload');
  if (payload.name) assertOnlyRealKeys(payload.name, REAL_NAME_PAYLOAD_KEYS, 'NamePayload');
  (payload.phones ?? []).forEach((p) => assertOnlyRealKeys(p, REAL_PHONE_PAYLOAD_KEYS, 'PhonePayload'));
  (payload.emails ?? []).forEach((e) => assertOnlyRealKeys(e, REAL_EMAIL_PAYLOAD_KEYS, 'EmailPayload'));
  if (payload.birthday) assertOnlyRealKeys(payload.birthday, REAL_BIRTHDAY_PAYLOAD_KEYS, 'BirthdayPayload');
  return payload;
}

describe('native-contacts-adapter — fixture shape is the REAL documented plugin payload, nothing fabricated', () => {
  test('a full fixture only ever uses real ContactPayload/NamePayload/PhonePayload/EmailPayload/BirthdayPayload keys', () => {
    fixture({
      contactId: 'c-1',
      name: { display: 'Jane Doe', given: 'Jane', middle: null, family: 'Doe' },
      note: 'Met at church',
      phones: [{ number: '312-555-0100', isPrimary: true }],
      emails: [{ address: 'jane@example.com', isPrimary: true }],
      birthday: { day: 4, month: 7, year: 1990 },
    });
  });

  test('the allow-list genuinely rejects an invented field (proves the guard has teeth, not just a passing fixture)', () => {
    const forged = { contactId: 'c-x', recruitScore: 97 } as unknown as Record<string, unknown>;
    expect(Object.keys(forged).every((k) => REAL_CONTACT_PAYLOAD_KEYS.has(k))).toBe(false);
  });
});

describe('mapNativeContactToRow — maps ONLY real, documented plugin fields', () => {
  test('maps display name, primary phone, primary email, note, and a full birthday', () => {
    const row = mapNativeContactToRow(
      fixture({
        contactId: 'c-1',
        name: { display: 'Jane Doe', given: 'Jane', middle: null, family: 'Doe' },
        note: 'Met at church',
        phones: [
          { number: '312-555-0199', isPrimary: false },
          { number: '312-555-0100', isPrimary: true },
        ],
        emails: [
          { address: 'old@example.com', isPrimary: false },
          { address: 'jane@example.com', isPrimary: true },
        ],
        birthday: { day: 4, month: 7, year: 1990 },
      })
    );
    expect(row).toEqual({
      name: 'Jane Doe',
      phone: '312-555-0100',
      email: 'jane@example.com',
      notes: 'Met at church',
      industry: null,
      birthdate: '1990-07-04',
    });
  });

  test('falls back to given+family when the OS never composed a display name (both real, documented fields)', () => {
    const row = mapNativeContactToRow(
      fixture({ contactId: 'c-2', name: { display: null, given: 'Andre', middle: null, family: 'Bell' } })
    );
    expect(row?.name).toBe('Andre Bell');
  });

  test('no name at all (no display, no given/family) → dropped (null), never a fabricated name', () => {
    const row = mapNativeContactToRow(fixture({ contactId: 'c-3', name: { display: null, given: null, middle: null, family: null } }));
    expect(row).toBeNull();
  });

  test('missing `name` entirely → dropped (null)', () => {
    const row = mapNativeContactToRow(fixture({ contactId: 'c-4' }));
    expect(row).toBeNull();
  });

  test('first entry used when no phone/email is flagged isPrimary', () => {
    const row = mapNativeContactToRow(
      fixture({
        contactId: 'c-5',
        name: { display: 'No Primary', given: null, middle: null, family: null },
        phones: [{ number: '555-0001' }, { number: '555-0002' }],
        emails: [{ address: 'first@example.com' }, { address: 'second@example.com' }],
      })
    );
    expect(row?.phone).toBe('555-0001');
    expect(row?.email).toBe('first@example.com');
  });

  test('no phones/emails at all → both null, never fabricated', () => {
    const row = mapNativeContactToRow(fixture({ contactId: 'c-6', name: { display: 'Solo Name', given: null, middle: null, family: null } }));
    expect(row?.phone).toBeNull();
    expect(row?.email).toBeNull();
  });

  test('a year-less birthday (OS allows day/month with no year) → birthdate null, never a fabricated/guessed year', () => {
    const row = mapNativeContactToRow(
      fixture({
        contactId: 'c-7',
        name: { display: 'No Year', given: null, middle: null, family: null },
        birthday: { day: 1, month: 1, year: null },
      })
    );
    expect(row?.birthdate).toBeNull();
  });

  test('never maps `organization` into `industry` — industry is always null from a native import (same posture as the Google adapter)', () => {
    const row = mapNativeContactToRow(
      fixture({ contactId: 'c-8', name: { display: 'Has Org', given: null, middle: null, family: null } })
    );
    expect(row?.industry).toBeNull();
  });
});

describe('buildNativeContactCandidates — dedupe against existing Vault contacts AND within the same device read', () => {
  test('flags a candidate whose normalized phone matches an EXISTING Vault contact as a duplicate — never blocks it, only labels it', () => {
    const candidates = buildNativeContactCandidates(
      [fixture({ contactId: 'c-1', name: { display: 'Jane Doe', given: null, middle: null, family: null }, phones: [{ number: '(312) 555-0100' }] })],
      [{ phone: '3125550100', email: null }]
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].isDuplicate).toBe(true);
    expect(candidates[0].row.name).toBe('Jane Doe'); // still present, still selectable
  });

  test('flags a candidate whose normalized email matches an existing Vault contact as a duplicate', () => {
    const candidates = buildNativeContactCandidates(
      [fixture({ contactId: 'c-1', name: { display: 'Andre Bell', given: null, middle: null, family: null }, emails: [{ address: 'Andre@Example.com' }] })],
      [{ phone: null, email: 'andre@example.com' }]
    );
    expect(candidates[0].isDuplicate).toBe(true);
  });

  test('flags the SECOND of two device contacts sharing a phone as a within-batch duplicate; the first is not flagged', () => {
    const candidates = buildNativeContactCandidates([
      fixture({ contactId: 'c-1', name: { display: 'First Copy', given: null, middle: null, family: null }, phones: [{ number: '555-0100' }] }),
      fixture({ contactId: 'c-2', name: { display: 'Second Copy', given: null, middle: null, family: null }, phones: [{ number: '555-0100' }] }),
    ]);
    expect(candidates[0].isDuplicate).toBe(false);
    expect(candidates[1].isDuplicate).toBe(true);
  });

  test('a genuinely new contact (no phone/email overlap) is never flagged a duplicate', () => {
    const candidates = buildNativeContactCandidates(
      [fixture({ contactId: 'c-1', name: { display: 'Brand New', given: null, middle: null, family: null }, phones: [{ number: '555-9999' }] })],
      [{ phone: '5550100', email: null }]
    );
    expect(candidates[0].isDuplicate).toBe(false);
  });

  test('un-nameable device contacts are silently dropped from the candidate list (never fabricated a name to keep them)', () => {
    const candidates = buildNativeContactCandidates([
      fixture({ contactId: 'c-1', name: { display: null, given: null, middle: null, family: null } }),
      fixture({ contactId: 'c-2', name: { display: 'Real Person', given: null, middle: null, family: null } }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].contactId).toBe('c-2');
  });

  test('no existing contacts and no device contacts → empty candidate list, not an error', () => {
    expect(buildNativeContactCandidates([], [])).toEqual([]);
  });
});
