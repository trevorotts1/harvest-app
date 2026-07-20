// T-40R (WP05 GATE remediation) — the reachability proofs for the messaging WRITE/TRIGGER surfaces
// the WP05 gate found ORPHANED: SequenceService (enroll + cadence), ObjectionService,
// ThreeWayHandoffService, EdificationService, EmailSendService had NO reachable caller (no route, no
// UI, no cron). This suite is the analog of tests/unit/conversation-mount.test.ts (the read-side
// precedent): it proves each surface is actually MOUNTED and REACHABLE — a route on disk that is
// session-gated and reads no forged identity header, a rep-facing affordance that navigates to it,
// and the two cron functions registered on the serve endpoint. It also proves the dead pre-WP05
// scaffold is GONE and referenced by nothing. It fails if any surface is unmounted, ungated, or if
// the scaffold is resurrected.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { isGatedDownstreamPage } from '@/lib/auth/onboarding-gate-edge';
import SequenceEnrollPanel from '@/app/community/components/SequenceEnrollPanel';
import ObjectionCoachPanel from '@/app/community/components/ObjectionCoachPanel';
import BridgeUplinePanel from '@/app/community/components/BridgeUplinePanel';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

function src(...parts: string[]): string {
  return readFileSync(path.join(SRC_DIR, ...parts), 'utf8');
}

// The header-READ call pattern (not the substring "x-user-id"), so a doc comment mentioning the
// header never false-positives — identical to conversation-mount.test.ts's rule.
const FORGED_HEADER_READ_RE = /\.headers\s*\.\s*get\(\s*['"`]x-user-id['"`]/;

/** Every NEW messaging route this unit adds — each must exist, be session-gated, and read no forged id. */
const ROUTES: { label: string; parts: string[]; endpoint: string }[] = [
  { label: 'sequence enroll', parts: ['app', 'api', 'messaging', 'sequence', 'route.ts'], endpoint: '/api/messaging/sequence' },
  { label: 'objection coach', parts: ['app', 'api', 'messaging', 'objection', 'route.ts'], endpoint: '/api/messaging/objection' },
  { label: 'handoff trigger', parts: ['app', 'api', 'messaging', 'handoff', 'trigger', 'route.ts'], endpoint: '/api/messaging/handoff/trigger' },
  { label: 'handoff join', parts: ['app', 'api', 'messaging', 'handoff', 'join', 'route.ts'], endpoint: '/api/messaging/handoff/join' },
  { label: 'email send', parts: ['app', 'api', 'messaging', 'email-send', 'route.ts'], endpoint: '/api/messaging/email-send' },
];

describe('T-40R — every new messaging route is MOUNTED, session-gated, and reads no forged x-user-id', () => {
  for (const r of ROUTES) {
    test(`${r.label} route exists at src/${r.parts.join('/')}`, () => {
      expect(existsSync(path.join(SRC_DIR, ...r.parts))).toBe(true);
    });
    test(`${r.label} route is session-gated (withOnboardingGate) and never trusts a forged x-user-id`, () => {
      const s = src(...r.parts);
      expect(s).toMatch(/withOnboardingGate/);
      expect(s).not.toMatch(FORGED_HEADER_READ_RE);
    });
  }
});

// ── (a) Sequences: enroll route + rep affordance + cadence cron ────────────────────────────────
describe('T-40R (a) — sequence enroll is reachable from the conversation surface, and routes through the gated service', () => {
  test('the sequence route enrolls via the gated SequenceService (buildSequenceService), never a raw send', () => {
    const s = src('app', 'api', 'messaging', 'sequence', 'route.ts');
    expect(s).toMatch(/buildSequenceService/);
    // The route CREATES a sequence; it must not itself dispatch a message (no send client here).
    expect(s).not.toMatch(/sendSms|sendEmail|\.message\.create/);
  });

  test('the contact-detail page mounts SequenceEnrollPanel (a real affordance, not a stub)', () => {
    const page = src('app', 'community', '[contactId]', 'page.tsx');
    expect(page).toMatch(/import\s+SequenceEnrollPanel\b/);
    expect(page).toMatch(/<SequenceEnrollPanel\b/);
  });

  test('TEETH: SequenceEnrollPanel posts to POST /api/messaging/sequence and renders a start affordance', () => {
    const comp = src('app', 'community', 'components', 'SequenceEnrollPanel.tsx');
    expect(comp).toContain('/api/messaging/sequence');
    const html = renderToStaticMarkup(createElement(SequenceEnrollPanel, { contactId: 'contact-77' }));
    expect(html).toContain('Start a sequence');
    expect(html).toMatch(/<button[^>]*>Start sequence<\/button>/);
  });

  test('the cadence cron logic (runDueSequences) is wired into the Inngest serve endpoint', () => {
    const fns = src('services', 'messaging', 'inngest', 'messaging-inngest-functions.ts');
    expect(fns).toMatch(/runDueSequences/);
    expect(fns).toMatch(/SCHEDULED_SEQUENCE_RUN_CRON/);
    expect(fns).toMatch(/messagingInngestFunctions/);
    const serve = src('app', 'api', 'inngest', 'route.ts');
    expect(serve).toMatch(/messagingInngestFunctions/);
  });
});

// ── (b) Objection coach: route + panel ─────────────────────────────────────────────────────────
describe('T-40R (b) — objection coach is reachable + gated (prepared draft is HELD, not sent)', () => {
  test('the contact-detail page mounts ObjectionCoachPanel', () => {
    const page = src('app', 'community', '[contactId]', 'page.tsx');
    expect(page).toMatch(/import\s+ObjectionCoachPanel\b/);
    expect(page).toMatch(/<ObjectionCoachPanel\b/);
  });

  test('the objection route prepares a HELD draft via ObjectionService (opens no send path)', () => {
    const s = src('app', 'api', 'messaging', 'objection', 'route.ts');
    expect(s).toMatch(/ObjectionService/);
    expect(s).not.toMatch(/sendSms|sendEmail|\.message\.create/);
  });

  test('TEETH: ObjectionCoachPanel posts to POST /api/messaging/objection and renders the "only you see this" coach', () => {
    const comp = src('app', 'community', 'components', 'ObjectionCoachPanel.tsx');
    expect(comp).toContain('/api/messaging/objection');
    const html = renderToStaticMarkup(createElement(ObjectionCoachPanel, { contactId: 'contact-77' }));
    expect(html).toContain('Objection coach');
    expect(html).toMatch(/only you see this/i);
  });
});

// ── (c) Three-way handoff: trigger/join routes + edification wired + panel ─────────────────────
describe('T-40R (c) — three-way handoff is reachable, org-gated, and wires the edification script', () => {
  test('the handoff trigger route wires EdificationService.generate into the flow', () => {
    const s = src('app', 'api', 'messaging', 'handoff', 'trigger', 'route.ts');
    expect(s).toMatch(/EdificationService/);
    expect(s).toMatch(/\.generate\(/);
    // org gate: the trigger passes the rep's organization_id onto the handoff.
    expect(s).toMatch(/organization_id|organizationId/);
  });

  test('the join route authorizes through ThreeWayHandoffService.join (the upline_id boundary)', () => {
    const s = src('app', 'api', 'messaging', 'handoff', 'join', 'route.ts');
    expect(s).toMatch(/ThreeWayHandoffService/);
    expect(s).toMatch(/\.join\(/);
  });

  test('the contact-detail page mounts BridgeUplinePanel', () => {
    const page = src('app', 'community', '[contactId]', 'page.tsx');
    expect(page).toMatch(/import\s+BridgeUplinePanel\b/);
    expect(page).toMatch(/<BridgeUplinePanel\b/);
  });

  test('TEETH: BridgeUplinePanel posts to POST /api/messaging/handoff/trigger and renders the bridge affordance', () => {
    const comp = src('app', 'community', 'components', 'BridgeUplinePanel.tsx');
    expect(comp).toContain('/api/messaging/handoff/trigger');
    const html = renderToStaticMarkup(createElement(BridgeUplinePanel, { contactId: 'contact-77' }));
    expect(html).toContain('Bridge my upline');
  });

  test('the return sweep logic (runHandoffReturnSweep) is registered on the Inngest serve endpoint', () => {
    const fns = src('services', 'messaging', 'inngest', 'messaging-inngest-functions.ts');
    expect(fns).toMatch(/runHandoffReturnSweep/);
    expect(fns).toMatch(/HANDOFF_RETURN_SWEEP_CRON/);
  });
});

// ── (d) Email send: route reachable + gated ────────────────────────────────────────────────────
describe('T-40R (d) — email send is reachable + routes through the fully-gated EmailSendService', () => {
  test('the email-send route calls the gated EmailSendService (buildEmailSendService), never a raw client', () => {
    const s = src('app', 'api', 'messaging', 'email-send', 'route.ts');
    expect(s).toMatch(/buildEmailSendService/);
    expect(s).toMatch(/resolveOrgSendingDomain/); // resolves the org's authenticated domain (no guessed sender)
    expect(s).not.toMatch(/sendEmail\(/); // never dispatches directly around the service
  });
});

// ── (no regression) /community/<id> stays session-gated ────────────────────────────────────────
describe('T-40R — the conversation surface these affordances sit on is still session-gated', () => {
  test('/community/<any-id> remains a gated downstream page (no middleware regression)', () => {
    expect(isGatedDownstreamPage('/community/contact-abc-123')).toBe(true);
  });
});

// ── (f) the dead pre-WP05 scaffold is GONE and referenced by nothing live ──────────────────────
const DEAD_SCAFFOLD_FILES = [
  ['services', 'messaging', 'engine.service.ts'],
  ['services', 'messaging', 'template.service.ts'],
  ['services', 'messaging', 'handoff.service.ts'],
  ['services', 'messaging', 'cadence.service.ts'],
  ['services', 'messaging', 'api-routes.ts'],
];
// The exact import specifiers of the deleted modules. `messaging/handoff.service` deliberately has the
// dot immediately after `handoff` so it can NEVER false-match the LIVE `messaging/handoff/three-way-
// handoff.service` (there the char after `messaging/handoff` is `/`, not `.`).
const DEAD_SPECIFIERS = [
  'messaging/engine.service',
  'messaging/template.service',
  'messaging/handoff.service',
  'messaging/cadence.service',
  'messaging/api-routes',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('T-40R (f) — the dead pre-WP05 messaging scaffold is deleted and referenced by nothing', () => {
  test('each dead scaffold file no longer exists on disk', () => {
    for (const parts of DEAD_SCAFFOLD_FILES) {
      expect(existsSync(path.join(SRC_DIR, ...parts))).toBe(false);
    }
  });

  test('the orphaned tests/unit/messaging.test.ts is removed', () => {
    expect(existsSync(path.join(REPO_ROOT, 'tests', 'unit', 'messaging.test.ts'))).toBe(false);
  });

  test('TEETH: no file under src imports any deleted scaffold module (grep-clean)', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const content = readFileSync(file, 'utf8');
      for (const spec of DEAD_SPECIFIERS) {
        if (content.includes(spec)) offenders.push(`${path.relative(REPO_ROOT, file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
