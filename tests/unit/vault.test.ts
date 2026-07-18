// T-22 — The Vault (master-spec §7.1 four ingestion modalities, §18.5 resumable/idempotent import,
// §7.6/§18.5 minors unreachable, §16.4 PII encrypted at rest). Exercises `VaultService` against an
// in-memory fake Prisma (no live DB, per repo pattern — see the DI-mockable interface convention
// documented in vault.service.ts's file header) so every claim below is a real, running assertion,
// not a description of intent.
//
// Each `describe` block states, in its title or a comment, what critical-failure condition (QC WP02
// block, §0.4) the test would trip if the guard it proves were ever removed.

import { MessageChannel } from '@prisma/client';

import { ContactSource, PipelineStage } from '../../src/types/warm-market';
import { hmacForMatch } from '../../src/services/compliance/encryption/encryption';
import {
  decryptOptionalField,
  decryptRequiredField,
} from '../../src/services/warm-market/vault/vault-encryption';
import {
  ImportLimitExceededError,
  parseContactCsv,
} from '../../src/services/warm-market/vault/csv-parser';
import { ageYearsFrom, isMinorRow } from '../../src/services/warm-market/vault/minors';
import { mapGoogleContactToRow } from '../../src/services/warm-market/vault/google-contacts-adapter';
import {
  ModalityNotAllowedError,
  VaultService,
  type VaultPrismaClient,
} from '../../src/services/warm-market/vault/vault.service';

// ── In-memory fake Prisma ──────────────────────────────────────────────────────────────────────
// A small, real (not a stub) implementation of the narrow VaultPrismaClient surface, backed by
// Maps — this is what lets the resumability/idempotency tests below exercise genuine multi-call
// sequencing (find → create/update → find again) instead of a brittle chain of
// `mockResolvedValueOnce` calls that would silently pass regardless of what queries actually ran.
function createFakeVaultPrisma() {
  const contacts = new Map<string, any>();
  const batchesByKey = new Map<string, any>();
  const batchesById = new Map<string, any>();
  const optOuts = new Map<string, any>();
  const interactions: any[] = [];
  let contactSeq = 0;
  let batchSeq = 0;

  const prisma: VaultPrismaClient = {
    importBatch: {
      findUnique: async ({ where }: any) => {
        const key = `${where.user_id_idempotency_key.user_id}::${where.user_id_idempotency_key.idempotency_key}`;
        return batchesByKey.get(key) ?? null;
      },
      create: async ({ data }: any) => {
        const id = `batch-${++batchSeq}`;
        const row = { id, ...data };
        batchesByKey.set(`${data.user_id}::${data.idempotency_key}`, row);
        batchesById.set(id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = batchesById.get(where.id);
        Object.assign(row, data);
        return row;
      },
    },
    contact: {
      findFirst: async ({ where }: any) => {
        for (const c of contacts.values()) {
          if (c.user_id !== where.user_id) continue;
          const or = where.OR ?? [];
          const matches = or.some(
            (cond: any) =>
              (cond.phone_hash && c.phone_hash === cond.phone_hash) ||
              (cond.email_hash && c.email_hash === cond.email_hash)
          );
          if (matches) return c;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = `contact-${++contactSeq}`;
        const row = { id, ...data };
        contacts.set(id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = contacts.get(where.id);
        Object.assign(row, data);
        return row;
      },
    },
    contactInteraction: {
      create: async ({ data }: any) => {
        interactions.push(data);
        return data;
      },
    },
    optOutRegistry: {
      upsert: async ({ create }: any) => {
        const key = `${create.identifier_hash}::${create.channel}`;
        if (!optOuts.has(key)) optOuts.set(key, create);
        return optOuts.get(key);
      },
    },
  };

  return { prisma, contacts, optOuts, interactions };
}

const NOW = new Date('2026-07-17T00:00:00Z');

describe('VaultService — four ingestion modalities land a normalized Contact row (§7.1)', () => {
  test('CSV modality: fuzzy-header CSV text parses and lands an encrypted, hash-deduped row', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const csvText = 'Full Name,Phone Number,E-mail\nJane CSV,(555) 111-2222,Jane.CSV@Example.com\n';

    const result = await vault.importBatch('user-1', ContactSource.CSV, undefined, {
      idempotencyKey: 'csv-1',
      csvText,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.importedCount).toBe(1);
    const [stored] = [...contacts.values()];
    expect(stored.phone_hash).toBe(hmacForMatch('5551112222'));
    expect(stored.email_hash).toBe(hmacForMatch('jane.csv@example.com'));
    expect(decryptRequiredField(stored.first_name)).toBe('Jane');
    expect(decryptRequiredField(stored.last_name)).toBe('CSV');
  });

  // T-29R2 (WP03 gate remediation follow-up, §8.2 eligibility) — the CSV capture path proof: this is
  // what makes `Contact.jurisdiction` populatable in production at all (the T-29R gate's fatal gap).
  test('T-29R2: CSV import WITH a "State" column lands a normalized (uppercase, trimmed) Contact.jurisdiction', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const csvText = 'Name,Phone,State\nTex Anderson,555-222-3333,  tx \n';

    const result = await vault.importBatch('user-1', ContactSource.CSV, undefined, {
      idempotencyKey: 'csv-state-1',
      csvText,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.importedCount).toBe(1);
    const [stored] = [...contacts.values()];
    expect(stored.jurisdiction).toBe('TX'); // normalized: uppercase + trimmed
  });

  test('T-29R2: CSV import WITHOUT a state/jurisdiction column still imports successfully — Contact.jurisdiction stays null, never blocks/fails the import', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const csvText = 'Name,Phone\nNo State Here,555-999-0000\n';

    const result = await vault.importBatch('user-1', ContactSource.CSV, undefined, {
      idempotencyKey: 'csv-no-state-1',
      csvText,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.importedCount).toBe(1);
    const [stored] = [...contacts.values()];
    expect(stored.jurisdiction).toBeNull();
  });

  test('T-29R2: a non-CSV modality (already-normalized rows) also lands a normalized jurisdiction when RawContactImportRow.jurisdiction is supplied', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);

    const result = await vault.importBatch(
      'user-1',
      ContactSource.IOS_NATIVE,
      [{ name: 'Nadia York', phone: '555-444-1111', jurisdiction: ' ny ' }],
      { idempotencyKey: 'ios-state-1', clientPlatform: 'ios' }
    );

    expect(result.importedCount).toBe(1);
    const [stored] = [...contacts.values()];
    expect(stored.jurisdiction).toBe('NY');
  });

  test('T-29R2: cross-source merge fills in jurisdiction ONLY when the existing row does not already have one (same "fill only empty fields" rule as phone/email/notes)', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);

    await vault.importBatch('user-1', ContactSource.CSV, [{ name: 'Carla Three', phone: '555-444-5555' }], {
      idempotencyKey: 'csv-batch-j',
    });
    await vault.importBatch(
      'user-1',
      ContactSource.IOS_NATIVE,
      [{ name: 'Carla Three', phone: '555-444-5555', jurisdiction: 'ca' }],
      { idempotencyKey: 'ios-batch-j', clientPlatform: 'ios' }
    );

    expect(contacts.size).toBe(1);
    const [merged] = [...contacts.values()];
    expect(merged.jurisdiction).toBe('CA'); // filled in from the second source, normalized

    // A THIRD import with a DIFFERENT state must never overwrite the jurisdiction already on file.
    await vault.importBatch(
      'user-1',
      ContactSource.CSV,
      [{ name: 'Carla Three', phone: '555-444-5555', jurisdiction: 'ny' }],
      { idempotencyKey: 'csv-batch-j2' }
    );
    const [afterThird] = [...contacts.values()];
    expect(afterThird.jurisdiction).toBe('CA'); // unchanged — never clobbered by a later import
  });

  test('iOS native modality: lands a row when clientPlatform=ios; refused (native-shell-only) otherwise', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const row = { name: 'Ana Ríos 😊', phone: '(555) 333-4444' };

    await expect(
      vault.importBatch('user-1', ContactSource.IOS_NATIVE, [row], {
        idempotencyKey: 'ios-from-web',
        clientPlatform: 'web',
      })
    ).rejects.toThrow(ModalityNotAllowedError);
    expect(contacts.size).toBe(0); // refused BEFORE any write — proves the gate runs first

    const result = await vault.importBatch('user-1', ContactSource.IOS_NATIVE, [row], {
      idempotencyKey: 'ios-1',
      clientPlatform: 'ios',
    });
    expect(result.importedCount).toBe(1);
    const [stored] = [...contacts.values()];
    // Emoji/nickname names tolerated (§7.6) — no crash, no stripping.
    expect(decryptRequiredField(stored.first_name)).toBe('Ana');
    expect(decryptRequiredField(stored.last_name)).toBe('Ríos 😊');
  });

  test('Android native modality: lands a row when clientPlatform=android; refused otherwise', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const row = { name: 'Deshawn Android', phone: '555-777-8888' };

    await expect(
      vault.importBatch('user-1', ContactSource.ANDROID_NATIVE, [row], { idempotencyKey: 'and-web' })
    ).rejects.toThrow(ModalityNotAllowedError);

    const result = await vault.importBatch('user-1', ContactSource.ANDROID_NATIVE, [row], {
      idempotencyKey: 'and-1',
      clientPlatform: 'android',
    });
    expect(result.importedCount).toBe(1);
    expect(contacts.size).toBe(1);
  });

  test('Google OAuth modality: an already-fetched People API resource maps + lands a normalized row', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const person = {
      names: [{ displayName: 'Priya Google' }],
      phoneNumbers: [{ value: '555-666-7777' }],
      emailAddresses: [{ value: 'priya@example.com' }],
    };
    const row = mapGoogleContactToRow(person);
    expect(row).not.toBeNull();

    const result = await vault.importBatch('user-1', ContactSource.GOOGLE_OAUTH, [row!], {
      idempotencyKey: 'google-1',
    });
    expect(result.importedCount).toBe(1);
    const [stored] = [...contacts.values()];
    expect(stored.phone_hash).toBe(hmacForMatch('5556667777'));
  });

  test('mapGoogleContactToRow drops a person with no displayName rather than fabricating a name', () => {
    expect(mapGoogleContactToRow({})).toBeNull();
  });
});

describe('PII encrypted at rest via the WP11 AES-256-GCM service (§7.1, §16.4) — CRITICAL if regressed', () => {
  test('stored name/phone/email/notes are ciphertext envelopes, never the raw value; dedupe key is the keyed HMAC, not plaintext', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const row = {
      name: 'Secret Person',
      phone: '5551234567',
      email: 'secret@example.com',
      notes: 'a very sensitive detail',
    };

    await vault.importBatch('user-1', ContactSource.MANUAL, [row], { idempotencyKey: 'enc-1' });
    const [stored] = [...contacts.values()];

    // This loop is what would fail the instant the encrypt call in vault.service.ts's upsertRow
    // were removed or bypassed — the raw value would then be directly present in the field.
    for (const raw of ['Secret', 'Person', '5551234567', 'secret@example.com', 'sensitive detail']) {
      expect(String(stored.first_name)).not.toContain(raw);
      expect(String(stored.phone)).not.toContain(raw);
      expect(String(stored.email)).not.toContain(raw);
      expect(String(stored.notes)).not.toContain(raw);
    }

    // Round-trips exactly via the WP11 decrypt path — proving it's real ciphertext, not e.g. base64.
    expect(decryptRequiredField(stored.first_name)).toBe('Secret');
    expect(decryptRequiredField(stored.last_name)).toBe('Person');
    expect(decryptOptionalField(stored.phone)).toBe('5551234567');
    expect(decryptOptionalField(stored.email)).toBe('secret@example.com');
    expect(decryptOptionalField(stored.notes)).toBe('a very sensitive detail');

    // Match/dedupe key is the keyed HMAC (never the plaintext, never the ciphertext).
    expect(stored.phone_hash).toBe(hmacForMatch('5551234567'));
    expect(stored.email_hash).toBe(hmacForMatch('secret@example.com'));
    expect(stored.phone_hash).not.toBe('5551234567');
    expect(stored.phone_hash).not.toBe(stored.phone);
  });

  test('a null phone/email/notes stays null — never encrypted-into an empty envelope', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    await vault.importBatch('user-1', ContactSource.MANUAL, [{ name: 'No Info Guy' }], {
      idempotencyKey: 'noinfo-1',
    });
    const [stored] = [...contacts.values()];
    expect(stored.phone).toBeNull();
    expect(stored.email).toBeNull();
    expect(stored.phone_hash).toBeNull();
    expect(stored.email_hash).toBeNull();
  });
});

describe('Import idempotency (§18.5 "re-running the same import creates no duplicates") — CRITICAL if regressed', () => {
  test('re-running the SAME idempotencyKey against a COMPLETED batch replays the cached result and reprocesses nothing', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const createSpy = jest.spyOn(prisma.contact, 'create');
    const row = { name: 'Alice One', email: 'alice.one@example.com' };

    const first = await vault.importBatch('user-1', ContactSource.CSV, [row], { idempotencyKey: 'k-1' });
    expect(first.status).toBe('COMPLETED');
    expect(first.idempotentReplay).toBe(false);
    expect(createSpy).toHaveBeenCalledTimes(1);

    const second = await vault.importBatch('user-1', ContactSource.CSV, [row], { idempotencyKey: 'k-1' });
    expect(second.idempotentReplay).toBe(true);
    expect(second.importedCount).toBe(1);
    expect(createSpy).toHaveBeenCalledTimes(1); // NOT called again
    expect(contacts.size).toBe(1); // exactly one Contact row exists
  });

  test('re-importing the same contact under a DIFFERENT idempotencyKey merges via HMAC dedupe instead of duplicating', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const row = { name: 'Bob Two', phone: '555-222-3333' };

    await vault.importBatch('user-1', ContactSource.CSV, [row], { idempotencyKey: 'k-1' });
    expect(contacts.size).toBe(1);

    const second = await vault.importBatch('user-1', ContactSource.CSV, [row], { idempotencyKey: 'k-2' });
    expect(second.mergedCount).toBe(1);
    expect(second.importedCount).toBe(0);
    expect(contacts.size).toBe(1); // still exactly one Contact row — proves dedupe, not batch-cache alone
  });

  test('cross-source merge keeps the most complete record and logs the overlap (§7.6)', async () => {
    const { prisma, contacts, interactions } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);

    await vault.importBatch('user-1', ContactSource.CSV, [{ name: 'Carla Three', phone: '555-444-5555' }], {
      idempotencyKey: 'csv-batch',
    });
    await vault.importBatch(
      'user-1',
      ContactSource.IOS_NATIVE,
      [{ name: 'Carla Three', phone: '555-444-5555', email: 'carla3@example.com' }],
      { idempotencyKey: 'ios-batch', clientPlatform: 'ios' }
    );

    expect(contacts.size).toBe(1);
    const [merged] = [...contacts.values()];
    expect(decryptOptionalField(merged.email)).toBe('carla3@example.com'); // filled in from the second source
    expect(interactions.some((i) => String(i.notes).includes('Cross-source duplicate merged'))).toBe(true);
  });
});

describe('Import resumability under partial failure (§18.5 "leaves a resumable state, not corruption") — CRITICAL if regressed', () => {
  test('a hard failure mid-batch stops at that row without corrupting or losing prior rows; resuming completes with no duplicates', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);

    const realCreate = prisma.contact.create;
    let attempts = 0;
    (prisma.contact as any).create = async (args: any) => {
      attempts++;
      if (attempts === 3) throw new Error('simulated transient DB outage');
      return realCreate(args);
    };

    const rows = [1, 2, 3, 4, 5].map((n) => ({ name: `Person ${n}`, phone: `55500000${n}` }));

    const first = await vault.importBatch('user-1', ContactSource.CSV, rows, { idempotencyKey: 'batch-A' });
    expect(first.status).toBe('IN_PROGRESS');
    expect(first.resumable).toBe(true);
    expect(first.cursor).toBe(2); // rows 0,1 committed; row 2's failed attempt did NOT advance the cursor
    expect(first.importedCount).toBe(2);
    expect(contacts.size).toBe(2); // no partial/corrupt row exists for the row that failed

    const second = await vault.importBatch('user-1', ContactSource.CSV, rows, { idempotencyKey: 'batch-A' });
    expect(second.status).toBe('COMPLETED');
    expect(second.resumable).toBe(false);
    expect(second.cursor).toBe(5);
    expect(second.importedCount).toBe(5);
    expect(contacts.size).toBe(5); // exactly 5 — the resume did not recreate rows 0/1
  });

  test('a row-level validation failure (missing name) is isolated to that row and does not abort the batch', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const rows = [{ name: 'Valid Row' }, { name: '' }, { name: 'Also Valid' }];

    const result = await vault.importBatch('user-1', ContactSource.CSV, rows as any, {
      idempotencyKey: 'validation-1',
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.importedCount).toBe(2);
    expect(result.errorRows).toEqual([{ index: 1, reason: 'Missing required "name" field' }]);
    expect(contacts.size).toBe(2);
  });
});

describe('Minors unreachable at ingestion (§18.5, §7.6) — CRITICAL if regressed', () => {
  test('a minor (age <18) is retained in the Vault but flagged do_not_contact + DO_NOT_CONTACT, and registered in OptOutRegistry with reason minor', async () => {
    const { prisma, contacts, optOuts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const row = { name: 'Kid Test', phone: '555-999-0000', email: 'kid@example.com', birthdate: '2015-01-01' };

    const result = await vault.importBatch('user-1', ContactSource.CSV, [row], { idempotencyKey: 'minor-1' });

    expect(result.minorFlaggedCount).toBe(1);
    const [stored] = [...contacts.values()];
    // Still imported (retained in the Vault, §7.6 "easy exclusion during segmentation" implies visible)…
    expect(stored).toBeDefined();
    // …but never outreach-eligible:
    expect(stored.is_minor_flag).toBe(true);
    expect(stored.do_not_contact).toBe(true);
    expect(stored.pipeline_stage).toBe(PipelineStage.DO_NOT_CONTACT);

    const phoneHash = hmacForMatch('5559990000');
    const emailHash = hmacForMatch('kid@example.com');
    expect(optOuts.get(`${phoneHash}::${MessageChannel.SMS_HANDOFF}`)?.reason).toBe('minor');
    expect(optOuts.get(`${phoneHash}::${MessageChannel.SMS_PLATFORM}`)?.reason).toBe('minor');
    expect(optOuts.get(`${emailHash}::${MessageChannel.EMAIL}`)?.reason).toBe('minor');
  });

  test('an explicitly-flagged minor (isMinor: true, no birthdate) is gated the same way', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    await vault.importBatch(
      'user-1',
      ContactSource.CSV,
      [{ name: 'Flagged Minor', phone: '555-000-1111', isMinor: true }],
      { idempotencyKey: 'minor-2' }
    );
    const [stored] = [...contacts.values()];
    expect(stored.is_minor_flag).toBe(true);
    expect(stored.do_not_contact).toBe(true);
  });

  test('a cross-source merge onto an existing minor keeps it gated (never un-flags on merge)', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    const phone = '555-321-4321';
    await vault.importBatch('user-1', ContactSource.CSV, [{ name: 'Merged Minor', phone, isMinor: true }], {
      idempotencyKey: 'minor-merge-1',
    });
    await vault.importBatch(
      'user-1',
      ContactSource.GOOGLE_OAUTH,
      [{ name: 'Merged Minor', phone, email: 'merged.minor@example.com' }],
      { idempotencyKey: 'minor-merge-2' }
    );
    const [stored] = [...contacts.values()];
    expect(stored.is_minor_flag).toBe(true);
    expect(stored.do_not_contact).toBe(true);
  });

  test('an adult contact is never flagged as a minor', async () => {
    const { prisma, contacts } = createFakeVaultPrisma();
    const vault = new VaultService(prisma);
    await vault.importBatch(
      'user-1',
      ContactSource.CSV,
      [{ name: 'Adult Person', phone: '555-888-9999', birthdate: '1990-05-01' }],
      { idempotencyKey: 'adult-1' }
    );
    const [stored] = [...contacts.values()];
    expect(stored.is_minor_flag).toBe(false);
    expect(stored.do_not_contact).toBe(false);
    expect(stored.pipeline_stage).toBe(PipelineStage.IDENTIFIED);
  });

  test('isMinorRow fails toward caution: an unparseable birthdate never clears the gate; no signal at all is not a minor', () => {
    expect(isMinorRow({ birthdate: 'not-a-real-date' })).toBe(true);
    expect(isMinorRow({})).toBe(false);
    expect(isMinorRow({ isMinor: false, birthdate: '1990-01-01' }, NOW)).toBe(false);
  });

  test('ageYearsFrom computes whole-year age correctly across a birthday boundary', () => {
    expect(ageYearsFrom('2015-01-01', NOW)).toBe(11);
    expect(ageYearsFrom('2008-07-18', NOW)).toBe(17); // birthday is tomorrow relative to NOW — not yet 18
    expect(ageYearsFrom('2008-07-16', NOW)).toBe(18); // birthday was yesterday — already 18
  });
});

describe('CSV parser — fuzzy header-map, limits, malformed/exotic rows (§7.1, §7.6)', () => {
  test('fuzzy-maps varied real-world header spellings onto the same logical fields', () => {
    const csv = 'Contact Name,Mobile,Email Address\nEmoji 🎉 Name,555-100-2000,emoji@example.com\n';
    const { rows, errorRows } = parseContactCsv(csv);
    expect(errorRows).toHaveLength(0);
    expect(rows).toEqual([
      { name: 'Emoji 🎉 Name', phone: '555-100-2000', email: 'emoji@example.com', notes: null, industry: null, birthdate: null, jurisdiction: null },
    ]);
  });

  // T-29R2 (WP03 gate remediation follow-up, §8.2 "Excluded: state-unlicensed" eligibility) — the
  // fatal gap the T-29R QC caught: NO production path wrote `Contact.jurisdiction`. CSV import is
  // now one of the two capture paths (the other is the manual PATCH route, tested in
  // contact-flags.test.ts).
  test('T-29R2: a "State" column fuzzy-maps onto jurisdiction, passed through raw (VaultService normalizes downstream)', () => {
    const csv = 'Name,State\nTex Anderson,tx\n';
    const { rows, errorRows } = parseContactCsv(csv);
    expect(errorRows).toHaveLength(0);
    expect(rows).toEqual([
      { name: 'Tex Anderson', phone: null, email: null, notes: null, industry: null, birthdate: null, jurisdiction: 'tx' },
    ]);
  });

  test('T-29R2: alternate header spellings ("Jurisdiction", "Contact State", "Licensing State") all fuzzy-map onto the same field', () => {
    const csv = 'Name,Jurisdiction\nA One,NY\n';
    expect(parseContactCsv(csv).rows[0].jurisdiction).toBe('NY');

    const csv2 = 'Name,Contact State\nB Two,CA\n';
    expect(parseContactCsv(csv2).rows[0].jurisdiction).toBe('CA');

    const csv3 = 'Name,Licensing State\nC Three,WA\n';
    expect(parseContactCsv(csv3).rows[0].jurisdiction).toBe('WA');
  });

  test('T-29R2: a CSV WITHOUT a state/jurisdiction column still imports successfully — jurisdiction just stays null, never blocks the import', () => {
    const csv = 'Name,Phone\nNo State Here,555-999-0000\n';
    const { rows, errorRows } = parseContactCsv(csv);
    expect(errorRows).toHaveLength(0);
    expect(rows[0].jurisdiction).toBeNull();
  });

  test('a row missing the name column becomes a downloadable error row, not a crash', () => {
    const csv = 'Name,Phone\nGood Row,555-1\n,555-2\n';
    const { rows, errorRows } = parseContactCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errorRows).toEqual([{ index: 1, raw: ',555-2', reason: 'Missing or unmapped "name" column' }]);
  });

  test('quoted fields with embedded commas parse correctly (exotic CSV)', () => {
    const csv = 'Name,Notes\n"Doe, Jane","Met at the ""county fair"", great chat"\n';
    const { rows } = parseContactCsv(csv);
    expect(rows[0].name).toBe('Doe, Jane');
    expect(rows[0].notes).toBe('Met at the "county fair", great chat');
  });

  test('rejects an upload over the 10,000-contact limit rather than silently truncating', () => {
    const header = 'Name,Phone\n';
    const body = Array.from({ length: 10_001 }, (_, i) => `Person ${i},555${i}`).join('\n');
    expect(() => parseContactCsv(header + body)).toThrow(ImportLimitExceededError);
  });
});
