#!/usr/bin/env node
/**
 * Post-build regression guard for T-04's CRITICAL defect class: `middleware.ts` silently failing
 * to register with Next.js.
 *
 * The concrete failure this guards against: `middleware.ts` lived at the repo root while this
 * project uses the `src/` directory, so Next.js never registered it — `.next/server/
 * middleware-manifest.json`'s `middleware` object built out empty, and the `/dashboard` auth gate
 * never ran (an unauthenticated `GET /dashboard` returned `200 OK` instead of redirecting to
 * `/auth`). No test or typecheck catches this, because the file compiles and lints fine in
 * isolation — the defect only manifests in the *compiled* build output. Hence this runs
 * post-build (`npm run build && npm run verify:middleware`), not as a Jest unit test.
 *
 * Checks:
 *   1. `.next/server/middleware-manifest.json` exists and parses as JSON.
 *   2. Its `middleware` object is non-empty (i.e. Next.js registered at least one middleware).
 *   3. At least one registered middleware's matcher covers `/dashboard`.
 *
 * Exits 0 on success, 1 with a descriptive message on any failure — meant to be wired into CI
 * immediately after `next build` so a regression (e.g. someone moving `middleware.ts` back out of
 * `src/`, or editing its `matcher` to drop `/dashboard`) fails the build instead of silently
 * shipping an unguarded route.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MANIFEST_PATH = path.join(process.cwd(), '.next', 'server', 'middleware-manifest.json');

function fail(message) {
  console.error(`✗ verify-middleware: ${message}`);
  process.exit(1);
}

if (!existsSync(MANIFEST_PATH)) {
  fail(
    `manifest not found at ${MANIFEST_PATH} — did you run "npm run build" first? ` +
      '(verify:middleware must run after next build, not instead of it.)'
  );
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch (err) {
  fail(`manifest at ${MANIFEST_PATH} did not parse as JSON: ${err.message}`);
}

const middleware = manifest.middleware;
const entries = middleware ? Object.values(middleware) : [];

if (!middleware || entries.length === 0) {
  fail(
    'middleware-manifest.json has an EMPTY "middleware" object — Next.js did not register any ' +
      'middleware. Likely cause: middleware.ts is not at the project root expected by Next.js ' +
      '(this project uses src/, so it must be src/middleware.ts). This is the exact regression ' +
      'that let an unauthenticated GET /dashboard return 200 OK in T-04.'
  );
}

const matchesDashboard = entries.some((entry) =>
  (entry.matchers || []).some((m) => {
    const source = m.originalSource || '';
    // Accept the literal source form ("/dashboard/:path*") as well as its compiled regexp form,
    // in case someone rewrites the matcher without the `originalSource` field surviving.
    return source.includes('/dashboard') || (m.regexp && m.regexp.includes('dashboard'));
  })
);

if (!matchesDashboard) {
  fail(
    'middleware is registered, but no matcher covers "/dashboard" — the auth gate for the ' +
      'authenticated-only surface is not wired. Check the `matcher` export in src/middleware.ts.'
  );
}

console.log(
  `✓ verify-middleware: middleware registered (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}), ` +
    '/dashboard matcher present.'
);
