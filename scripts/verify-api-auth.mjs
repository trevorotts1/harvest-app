#!/usr/bin/env node
/**
 * Post-build regression guard for T-04's second CRITICAL defect class: an `/api/**` route handler
 * that trusts a client-forged identity header (`x-user-id` or similar) as if it were a real,
 * verified session — and, worse, uses that unverified identity to read/write a real data store.
 *
 * Concrete failure this guards against: every route under `src/app/api/**` that predates real
 * auth (contacts/*, harvest-method/*, mission-control/briefing, onboarding/*, demo/seed — see the
 * DEFERRED CALL-SITE WIRING note in src/lib/auth/with-role.ts) reads `request.headers.get
 * ('x-user-id')` and trusts it outright. Today every one of those routes only ever returns
 * in-memory/demo data, so a forged header is harmless. The instant any of those routes (or a new
 * one copy-pasted from them) is wired to `@/lib/prisma`/`@prisma/client` to serve *real* per-user
 * data, that combination — trust a forged header, use it to key a real DB read/write — becomes a
 * live cross-account authorization bypass: attacker sends `x-user-id: <victim>` and reads/writes
 * the victim's real data with zero credentials. No test or typecheck catches this, because each
 * half (reading the header; importing prisma) is fine in isolation — it's the *combination*, and
 * specifically the absence of a real session check, that's the defect. Hence this runs as a static
 * source scan wired into `postbuild` (`npm run build && npm run verify:api-auth`), so it fails the
 * build the moment someone adds real persistence behind a header-trusting route, not just when a
 * test happens to exercise that route.
 *
 * Rule enforced, per `src/app/api/**\/route.ts` file:
 *   FAIL if the file BOTH
 *     (a) reads a client-forged identity header (`x-user-id`, or another `x-user-*` /
 *         `x-auth-*` / `x-identity-*` header) via `<something>.headers.get(...)`, AND
 *     (b) imports a real data store (`@/lib/prisma`, `@prisma/client`, or a bare `prisma`
 *         module specifier)
 *   UNLESS the file also goes through a real, verified session — i.e. it imports at least one
 *   of `getCurrentSession`, `getServerSession`, `withRole`, or `requireRole` — in which case the
 *   header may still be present (e.g. as a deprecated fallback mid-migration) but is no longer the
 *   sole gate, so it is not flagged.
 *
 * This is deliberately a static, textual scan (no TypeScript type-checking, no runtime execution)
 * so it is cheap, has zero false negatives for the "did you even import prisma" question, and
 * cannot be defeated by a route that merely *type-checks* — it looks at what the file actually
 * imports and calls.
 *
 * Exits 0 on success, 1 with a descriptive per-file report on any failure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api');

const IDENTITY_HEADER_CALL_RE = /\.headers\s*\.\s*get\(\s*(['"`])([^'"`]+)\1/g;
const IDENTITY_HEADER_NAME_RE = /^x-(user|auth|identity)/i;

const REAL_DATA_STORE_IMPORT_RE =
  /from\s+(['"`])(@\/lib\/prisma|@prisma\/client|prisma)\1|require\(\s*(['"`])(@\/lib\/prisma|@prisma\/client|prisma)\3\s*\)/;

const REAL_SESSION_MARKER_RE = /\b(getCurrentSession|getServerSession|withRole|requireRole)\b/;

function fail(message) {
  console.error(`✗ verify-api-auth: ${message}`);
}

function findRouteFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findRouteFiles(full));
    } else if (entry === 'route.ts' || entry === 'route.js') {
      results.push(full);
    }
  }
  return results;
}

if (!existsSync(API_ROOT)) {
  fail(`expected API root not found at ${API_ROOT} — is this being run from the repo root?`);
  process.exit(1);
}

const routeFiles = findRouteFiles(API_ROOT).sort();

if (routeFiles.length === 0) {
  fail(`no route.ts files found under ${API_ROOT} — the scan can't have missed every route, ` +
    'so something is wrong with the search itself (wrong cwd? routes moved?).');
  process.exit(1);
}

const violations = [];

for (const file of routeFiles) {
  const relPath = path.relative(process.cwd(), file);
  const source = readFileSync(file, 'utf8');

  const identityHeaders = new Set();
  for (const match of source.matchAll(IDENTITY_HEADER_CALL_RE)) {
    const headerName = match[2];
    if (IDENTITY_HEADER_NAME_RE.test(headerName)) {
      identityHeaders.add(headerName);
    }
  }
  const trustsIdentityHeader = identityHeaders.size > 0;
  const importsRealDataStore = REAL_DATA_STORE_IMPORT_RE.test(source);
  const hasRealSessionGuard = REAL_SESSION_MARKER_RE.test(source);

  if (trustsIdentityHeader && importsRealDataStore && !hasRealSessionGuard) {
    violations.push({
      relPath,
      identityHeaders: [...identityHeaders],
    });
  }
}

if (violations.length > 0) {
  const plural = violations.length !== 1;
  fail(
    `${violations.length} route${plural ? 's' : ''} trust${plural ? '' : 's'} a forged identity ` +
      `header AND import${plural ? '' : 's'} a real data store with no real session guard ` +
      '(getCurrentSession/getServerSession/withRole/requireRole). This is a live cross-account ' +
      'authorization bypass the moment the route serves real data:'
  );
  for (const v of violations) {
    console.error(`  - ${v.relPath} (header: ${v.identityHeaders.join(', ')})`);
  }
  console.error(
    '\nFix: route the handler through getCurrentSession()/withRole()/requireRole() ' +
      '(src/lib/auth/session.ts, src/lib/auth/with-role.ts, src/lib/auth/rbac.ts) before it reads ' +
      'or writes @/lib/prisma data, instead of trusting the client-supplied header.'
  );
  process.exit(1);
}

console.log(
  `✓ verify-api-auth: scanned ${routeFiles.length} route file${routeFiles.length === 1 ? '' : 's'} under ` +
    'src/app/api — no route trusts a forged identity header while importing a real data store ' +
    'without a real session guard.'
);
