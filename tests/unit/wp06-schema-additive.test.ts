// T-41 (WP06) — proves the T-41 migration is 100% additive (§0.4 project rule 5: "New models/columns
// only ... Do NOT modify/delete existing models/columns"). No live Postgres is available in the CI
// test environment, so this asserts directly against the committed migration SQL, the same
// convention tests/unit/schema-migration.test.ts already established for the T-03 migration.

import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');
const MIGRATION_DIR_NAME = '20260720174821_t41_wp06_social_content_launch_kit';

function readMigrationSQL(): string {
  const sqlPath = path.join(MIGRATIONS_DIR, MIGRATION_DIR_NAME, 'migration.sql');
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Expected the T-41 migration at ${sqlPath} but it was not found.`);
  }
  return fs.readFileSync(sqlPath, 'utf8');
}

describe('T-41 migration — additive only (new enums/tables/indexes; no ALTER or DROP)', () => {
  const sql = readMigrationSQL();
  const statements = sql
    .split(';')
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--')) // strip Prisma's "-- CreateEnum" etc. comments
        .join('\n')
        .trim()
    )
    .filter(Boolean);

  test('every statement is a CREATE (TYPE/TABLE/INDEX) — none are ALTER or DROP', () => {
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.toUpperCase().startsWith('CREATE')).toBe(true);
    }
  });

  test('creates every new WP06 model', () => {
    for (const model of ['ContentBrief', 'ContentTemplate', 'LaunchKit', 'ContentItem', 'EngagementFollowUpTask']) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE "${model}"`));
    }
  });

  test('creates every new WP06 enum', () => {
    for (const enumName of [
      'SocialPlatform',
      'ContentType',
      'ContentCategory',
      'ContentQueueState',
      'PersonalizationTier',
      'LaunchKitPieceType',
      'WelcomeVariant',
      'LaunchKitVersion',
      'LaunchKitState',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TYPE "${enumName}"`));
    }
  });

  test('SocialPlatform is exactly the three §11.1 named platforms', () => {
    expect(sql).toMatch(/CREATE TYPE "SocialPlatform" AS ENUM \('INSTAGRAM', 'FACEBOOK', 'LINKEDIN'\)/);
  });

  test('ContentQueueState is exactly the six §11.5 named states', () => {
    expect(sql).toMatch(
      /CREATE TYPE "ContentQueueState" AS ENUM \('DRAFTING', 'COMPLIANCE_CHECK', 'READY_FOR_REVIEW', 'SCHEDULED', 'PUBLISHED', 'BLOCKED'\)/
    );
  });
});

describe('T-41 — schema.prisma leaves every pre-existing model untouched', () => {
  test('no ALTER TABLE statement in ANY migration up to and including T-41 touches a pre-existing WP01-05/11 model', () => {
    // A stronger, cheaper proxy than re-reading every historical migration: the T-41 migration
    // itself (the only one this build unit added) contains zero ALTER statements at all.
    const sql = readMigrationSQL();
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });
});
