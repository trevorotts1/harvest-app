// T-03 QC fix (defect 3): no live Postgres database is available in this test environment, so
// these tests assert directly against the generated migration SQL that the DB-enforced integrity
// rules the schema promises (§3.4 idempotency, slot-locking, opt-out precedence; §15 double-
// provisioning guard) actually exist as real constraints/indexes — not just as comments.
import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');

function findEvolveMigrationSQL(): string {
  const entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && e.name.endsWith('_evolve_to_spec_v3'))
    .map((e) => e.name)
    .sort();

  if (dirs.length === 0) {
    throw new Error(
      `Expected a prisma/migrations/<timestamp>_evolve_to_spec_v3/ directory but found none in ${MIGRATIONS_DIR}`
    );
  }

  // Most recent (lexicographically last, since directory names are timestamp-prefixed) wins.
  const dir = dirs[dirs.length - 1];
  const sqlPath = path.join(MIGRATIONS_DIR, dir, 'migration.sql');
  return fs.readFileSync(sqlPath, 'utf8');
}

describe('T-03 migration — committed SQL enforces the schema invariants', () => {
  const sql = findEvolveMigrationSQL();

  test('migration_lock.toml pins the postgresql provider', () => {
    const lockPath = path.join(MIGRATIONS_DIR, 'migration_lock.toml');
    expect(fs.existsSync(lockPath)).toBe(true);
    const lock = fs.readFileSync(lockPath, 'utf8');
    expect(lock).toMatch(/provider\s*=\s*"postgresql"/);
  });

  test('defect 1: at most one ACTIVE Subscription per user (partial unique index)', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "subscription_one_active_per_user" ON "Subscription"\("user_id"\)\s+WHERE "status" = 'ACTIVE'/
    );
  });

  test('defect 1: at most one ACTIVE Sponsorship per member (partial unique index)', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "sponsorship_one_active_per_member" ON "Sponsorship"\("member_user_id"\)\s+WHERE "state" = 'ACTIVE'/
    );
  });

  test('§3.4/§18.4: Appointment slot-lock uniqueness (atomic confirm, no double-booking)', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "Appointment_slot_lock_id_key" ON "Appointment"\("slot_lock_id"\)/);
  });

  test('§3.4/§15.5: IdempotencyLog.key uniqueness (webhook + agent-dispatch dedup)', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "IdempotencyLog_key_key" ON "IdempotencyLog"\("key"\)/);
  });

  test('§10.4: OptOutRegistry (identifier_hash, channel) uniqueness (opt-out precedence)', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "OptOutRegistry_identifier_hash_channel_key" ON "OptOutRegistry"\("identifier_hash", "channel"\)/
    );
  });

  test('sanity: the four pre-existing schema-level uniques are still present verbatim', () => {
    // Guards against a future regeneration silently dropping constraints the schema comments
    // above them promise (e.g. if someone re-ran `prisma migrate diff` without re-appending the
    // hand-written partial indexes).
    expect(sql).toContain('CREATE UNIQUE INDEX "User_email_key" ON "User"("email");');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "Milestone_user_id_milestone_key_key" ON "Milestone"("user_id", "milestone_key");'
    );
  });
});
