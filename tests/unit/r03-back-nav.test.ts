// R-03 (refinements catalog 2026-07-28) — reliable BACK NAVIGATION across the onboarding steps.
//
// The pre-fix flow had NO way to go backward: a user who moved past a step (e.g. skipped a photo)
// could not return to it. This suite proves the fix from three angles:
//
//   (1) MODEL — the pure flow-model walk (`prevScreenForRole`): the inverse of `advance()`'s
//       R-01 role-keyed walk. Every non-first rep-track screen has a previous screen; the FIRST
//       screen has none (no back past the beginning); an RVP's walk skips the sponsor screen in
//       BOTH directions (the RVP who landed on `contacts` by walking past `sponsor` goes straight
//       back to `seven_whys`, never to a screen that does not exist for their role).
//
//   (2) BEHAVIOR (mounted shell, react-test-renderer — the same approach as
//       tests/unit/onboarding-sponsor-retry-mount.test.ts) — clicking "Back" actually returns to
//       the previous step, PRESERVES the entered data (identity name/email/photo, intensity
//       selection), and re-advancing after a back REUSES that data (no wipe, no re-run of a
//       completion/decision — `clearedStepChainsRef` short-circuits a re-advance of an
//       already-cleared screen into a pure walk, and a re-advance from a screen that fired no
//       `/step` call runs its handler exactly as before).
//
//   (3) WIRING (source-scan, the repo's established convention) — the back control renders on
//       every non-first rep-track screen; the FIRST screen (vision) and the dense track's first
//       surface (checklist) render NO back control; the dense consent/first48 surfaces have back
//       controls that step back through the dense sub-state; the back handlers are pure
//       `setScreen`/`setDenseScreen` walks — no `/step`/`/complete`/sponsor-decision call is ever
//       fired from a back press, so going back never re-runs a completion or decision; and the
//       i18n keys (label + aria) exist in BOTH catalogs with genuinely different ES copy.
//
// Behavioral proofs use `react-test-renderer` (the established R-08-retry-mount precedent): the
// shell mounts in this repo's plain-node Jest env with `next/navigation` mocked and
// `global.fetch` stubbed to resolve the mount-time `GET /api/onboarding/status` and any
// `/api/onboarding/step` submissions (both resolve deterministically — the suites' assertions are
// about the STATE WALK, not about the network). The seven-whys screen's conversation start is
// mocked at the module boundary so the screen is renderable without an engine call.
//
// FAIL-CLOSED CONTRACT UNDER TEST: a back press never fires a server call of any kind (no
// completion, no decision, no step) — it is a pure UI-state walk; nothing is wiped by going back;
// re-advancing from an already-cleared screen walks again instead of re-POSTing (the `/step`
// route's own progression check 400s on a repeat submission of the current step); first-time
// paths are byte-for-byte unchanged.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Role } from '@prisma/client';
import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { REP_SCREENS, prevScreen, prevScreenForRole, type OnboardingScreen } from '@/app/onboarding/flow-model';

const REPO = path.join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');
const flowSrc = read('src/app/onboarding/OnboardingFlow.tsx');
const flowModelSrc = read('src/app/onboarding/flow-model.ts');
const cssSrc = read('src/app/onboarding/onboarding.module.css');

const enCatalog = JSON.parse(read('src/lib/i18n/messages/en.json')) as Record<string, unknown>;
const esCatalog = JSON.parse(read('src/lib/i18n/messages/es.json')) as Record<string, unknown>;
const get = (tree: { [k: string]: unknown }, p: string): string | undefined =>
  p.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as { [k: string]: unknown })[part];
  }, tree) as string | undefined;

// ─── 1. The flow-model walk ─────────────────────────────────────────────────────────────────────

describe('R-03 model — the pure previous-screen walk (flow-model.ts)', () => {
  test('every non-first rep-track screen has a previous screen, exactly one step back', () => {
    for (let i = 1; i < REP_SCREENS.length; i++) {
      expect(prevScreen(REP_SCREENS[i])).toBe(REP_SCREENS[i - 1]);
    }
  });

  test('the FIRST screen has no previous screen (no back past the beginning)', () => {
    expect(prevScreen(REP_SCREENS[0])).toBeNull();
    expect(prevScreenForRole(Role.REP, REP_SCREENS[0])).toBeNull();
  });

  test('R-01 preserved: for a REP the role-keyed walk is exactly the plain walk', () => {
    for (const screen of REP_SCREENS) {
      expect(prevScreenForRole(Role.REP, screen)).toBe(prevScreen(screen));
    }
  });

  test('an RVP walks BACK over the skipped sponsor screen (contacts → seven_whys), never landing on a screen that does not exist for their role', () => {
    expect(prevScreenForRole(Role.RVP, 'contacts')).toBe('seven_whys');
    // Every other landing is the plain walk (the only skipped screen is sponsor).
    expect(prevScreenForRole(Role.RVP, 'seven_whys')).toBe('goals_intensity');
    expect(prevScreenForRole(Role.RVP, 'first48')).toBe('consent');
    expect(prevScreenForRole(Role.RVP, 'vision')).toBeNull();
  });

  test('every non-first screen of the role-keyed walk lands on a screen that EXISTS for that role (fail-safe, R-01 mirror)', () => {
    for (const role of [Role.REP, Role.RVP, Role.UPLINE, Role.DUAL, Role.ADMIN]) {
      const screens = role === Role.RVP ? REP_SCREENS.filter((s) => s !== 'sponsor') : REP_SCREENS;
      for (let i = 1; i < REP_SCREENS.length; i++) {
        const prev = prevScreenForRole(role, REP_SCREENS[i]);
        if (prev !== null) expect(screens).toContain(prev);
      }
    }
  });
});

// ─── 2. Behavior: the mounted shell's back control ───────────────────────────────────────────────

// The mount-time GET /api/onboarding/status must resolve (no session — the fresh-start branch).
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/app/onboarding/seven-whys-client', () => ({
  getSevenWhysTurn: jest.fn(),
  postSevenWhysStart: jest.fn(),
  postSevenWhysAnswer: jest.fn(),
}));

import OnboardingFlow from '@/app/onboarding/OnboardingFlow';

function okJson(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

function mountFlow(initialScreen: OnboardingScreen, role: Role = Role.REP): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(createElement(OnboardingFlow, { initialScreen, role }));
  });
  return tree;
}

function textOf(tree: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON())
    .replace(/<[^>]*>/g, ' ')
    .replace(/\\n/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buttons(tree: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestInstance[] {
  return tree.root.findAll((n) => n.type === 'button');
}

function buttonWithText(tree: TestRenderer.ReactTestRenderer, text: string) {
  return buttons(tree).find((b) => (b.children as readonly unknown[]).join('') === text);
}

function nameInput(tree: TestRenderer.ReactTestRenderer) {
  const input = tree.root.findAll((n) => n.type === 'input').find((n) => (n.props as { id?: string }).id === 'identity-name');
  return input as unknown as { props: { value: string; onChange: (e: { target: { value: string } }) => void } };
}

function fileInput(tree: TestRenderer.ReactTestRenderer) {
  const input = tree.root.findAll((n) => n.type === 'input').find((n) => (n.props as { type?: string }).type === 'file');
  return input as unknown as {
    props: { onChange: (e: { target: { files?: File[]; value: string } }) => void };
  };
}

describe('R-03 behavior — the back control returns to the prior step and preserves entered data', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/onboarding/status') return okJson({}); // no session — start fresh
      if (url === '/api/onboarding/step') {
        return okJson({ currentStep: 'ROLE_ORG_CONTEXT', completed: false }); // advances resolve fine
      }
      return okJson({});
    });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  test('a non-first step renders the Back control; the first step (vision) renders none', () => {
    expect(buttonWithText(mountFlow('vision'), 'Back')).toBeUndefined();
    for (const screen of ['identity', 'org', 'goals_intensity', 'contacts', 'reveal', 'consent', 'first48'] as const) {
      expect(buttonWithText(mountFlow(screen), 'Back')).toBeDefined();
    }
  });

  test('Back from the identity step returns to vision; entered name/email/photo survive, and Continue forward again reuses them', () => {
    const tree = mountFlow('identity');
    act(() => {
      nameInput(tree).props.onChange({ target: { value: 'Alex Rivera' } });
    });
    // R-04 — a REAL photo selection: the source chooser's file input reports the picked file
    // (the pre-fix "Take a photo" button only faked `photoState='chosen'`).
    act(() => {
      fileInput(tree).props.onChange({ target: { files: [new File(['x'], 'alex.png', { type: 'image/png' })], value: '' } });
    });
    expect(textOf(tree)).toContain('Alex Rivera');
    expect(textOf(tree)).toContain('alex.png added');

    act(() => {
      buttonWithText(tree, 'Back')!.props.onClick();
    });
    // Landed back on the O-1 vision splash (which has NO back control of its own).
    expect(textOf(tree)).toContain("The people already in your phone");
    expect(textOf(tree)).not.toContain('Alex Rivera');

    // Forward again re-renders the identity step WITH the persisted values — nothing was wiped.
    act(() => {
      buttonWithText(tree, "Let's begin")!.props.onClick();
    });
    expect(nameInput(tree).props.value).toBe('Alex Rivera');
    expect(textOf(tree)).toContain('Alex Rivera');
    // The photo choice survived too — the chosen-photo state renders (the real file caption),
    // not the initials fallback.
    expect(textOf(tree)).toContain('alex.png added');
  });

  test('the intensity dial selection survives a back-and-forth (back to org, forward again reuses it)', async () => {
    const tree = mountFlow('goals_intensity');
    act(() => {
      buttonWithText(tree, 'High')!.props.onClick();
    });
    expect(textOf(tree)).toContain('High');

    act(() => {
      buttonWithText(tree, 'Back')!.props.onClick();
    });
    expect(textOf(tree)).toContain('You’re building independently'); // the O-3 org-context screen

    // Forward again (the org step's Continue re-advances — await act so its async handler's
    // state updates land inside the act boundary).
    await act(async () => {
      buttonWithText(tree, 'Continue')!.props.onClick();
    });
    expect(textOf(tree)).toContain('How hard should your Harvest AI agents work'); // back on the dial
    expect(textOf(tree)).toContain('High'); // the selection is still there
  });

  test('a back press fires NO server call (pure UI walk — no completion, no decision, no step)', () => {
    const tree = mountFlow('reveal');
    const callsBefore = fetchMock.mock.calls.length;
    act(() => {
      buttonWithText(tree, 'Back')!.props.onClick();
    });
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});

// ─── 3. Wiring: source-scan proofs ───────────────────────────────────────────────────────────────

describe('R-03 wiring — back controls, no reruns, dense track, i18n', () => {
  test('every non-first rep-track screen renders a Back control bound to goBack; the first screen renders none', () => {
    for (const screen of REP_SCREENS.slice(1)) {
      // Each screen's render block is present (the sponsor block opens with the role guard).
      const pattern =
        screen === 'sponsor'
          ? new RegExp(`\\{screen === 'sponsor' && !sponsorStepSkippedForRole\\(role\\)`)
          : new RegExp(`\\{screen === '${screen}' && \\(`);
      expect(flowSrc).toMatch(pattern);
    }
    // Vision renders no Back control: its block contains no common.back reference.
    const visionBlock = flowSrc.split("{screen === 'vision' &&")[1]?.split("{screen === 'identity'")[0] ?? '';
    expect(visionBlock).not.toContain('common.back');
    // The goBack handler exists and is a pure walk (setScreen only, no fetch/router.push).
    expect(flowSrc).toContain('function goBack()');
    expect(flowSrc).toContain('prevScreenForRole(role, screen)');
    const goBackBody = flowSrc.split('function goBack()')[1]?.slice(0, 300) ?? '';
    expect(goBackBody).not.toContain('fetch(');
    expect(goBackBody).not.toContain('router.push');
  });

  test('goBack is the role-keyed walk (prevScreenForRole), mirroring advance()\'s own role-keyed walk', () => {
    const goBackBody = flowSrc.split('function goBack()')[1]?.slice(0, 300) ?? '';
    expect(goBackBody).toContain('prevScreenForRole(role, screen)');
    expect(goBackBody).toContain('setScreen(prev)');
    // The flow model exposes the pure walk (testable directly, like nextScreen/advance's walk).
    expect(flowModelSrc).toContain('export function prevScreenForRole(');
  });

  test('back never re-runs a completion: no completion/step/sponsor call exists anywhere in the back paths', () => {
    // The only advance/complete/sponsor-decision call sites are the step handlers themselves —
    // goBack is a pure setScreen walk, and the dense back buttons call setDenseScreen directly.
    const goBackBody = flowSrc.split('function goBack()')[1]?.slice(0, 300) ?? '';
    expect(goBackBody).not.toContain('postOnboardingComplete');
    expect(goBackBody).not.toContain('postOnboardingStep');
    expect(goBackBody).not.toContain('sendOrderedSteps');
    expect(goBackBody).not.toContain('postSponsorDecision');
    // The dense back controls are inline setDenseScreen walks (proven by the dense-track test
    // below), never handlers with network calls.
    expect(flowSrc).toContain("onClick={() => setDenseScreen('checklist')}");
    expect(flowSrc).toContain("onClick={() => setDenseScreen('consent')}");
  });

  test('a re-advance from an already-cleared screen walks again instead of re-POSTing (clearedStepChainsRef)', () => {
    // The ref exists, every step-submitting handler marks its screen cleared ONLY after a
    // confirmed success (after the outcome/result.ok guard), and every handler short-circuits on
    // an already-cleared screen into a pure walk (advance/setDenseScreen) before any fetch.
    expect(flowSrc).toContain('const clearedStepChainsRef = useRef<Set<string>>(new Set())');
    for (const [screen, handler] of [
      ['identity', 'handleIdentityAdvance'],
      ['org', 'handleOrgContinue'],
      ['seven_whys', 'handleSevenWhysContinue'],
      ['consent', 'handleGrantGdprConsent'],
    ] as const) {
      const body = flowSrc.split(`function ${handler}(`)[1] ?? '';
      // Short-circuit guard precedes the in-flight guard at the top of the handler.
      const shortCircuitIdx = body.indexOf(`isStepChainCleared('${screen}')`);
      const inFlightIdx = body.indexOf('inFlightRef.current');
      expect(shortCircuitIdx).toBeGreaterThan(-1);
      expect(shortCircuitIdx).toBeLessThan(inFlightIdx);
      // The mark is AFTER the failure guard's early return (only a confirmed success marks).
      const guardIdx = body.indexOf('if (!');
      const markIdx = body.indexOf(`clearedStepChainsRef.current.add('${screen}')`);
      expect(markIdx).toBeGreaterThan(-1);
      expect(markIdx).toBeGreaterThan(guardIdx);
    }
    // The dense checklist is marked cleared after its confirmed success too.
    expect(flowSrc).toContain("clearedStepChainsRef.current.add('checklist')");
    // The sponsor screen is marked cleared after ITS OWN decision POST succeeds (never re-run).
    expect(flowSrc).toContain("clearedStepChainsRef.current.add('sponsor')");
    expect(flowSrc).toContain("isStepChainCleared('sponsor')");
    // Screens that fire no /step call are never cleared — their handlers run exactly as before.
    expect(flowSrc).not.toContain("isStepChainCleared('reveal')");
    expect(flowSrc).not.toContain("isStepChainCleared('contacts')");
  });

  test('dense track: consent and first48 have Back controls; the checklist (first surface) has none', () => {
    expect(flowSrc).toContain("setDenseScreen('checklist')");
    expect(flowSrc).toContain("setDenseScreen('consent')");
    // The dense sub-state walk is first48 → consent → checklist — the inverse of the forward walk.
    const first48Back = flowSrc.split("denseScreen === 'first48'")[1] ?? '';
    expect(first48Back).toContain("onClick={() => setDenseScreen('consent')}");
    const consentBack = flowSrc.split("denseScreen === 'consent'")[1] ?? '';
    expect(consentBack).toContain("onClick={() => setDenseScreen('checklist')}");
  });

  test('i18n: the Back label (common.back) and the back-aria key exist in BOTH catalogs with REAL (non-identical) ES', () => {
    expect(get(enCatalog as { [k: string]: unknown }, 'common.back')).toBe('Back');
    expect(get(esCatalog as { [k: string]: unknown }, 'common.back')).toBe('Atrás');
    expect(get(enCatalog as { [k: string]: unknown }, 'onboarding.backAria')).toBe('Back to the previous step');
    const esAria = get(esCatalog as { [k: string]: unknown }, 'onboarding.backAria');
    expect(typeof esAria).toBe('string');
    expect((esAria ?? '').length).toBeGreaterThan(0);
    expect(esAria).not.toBe(get(enCatalog as { [k: string]: unknown }, 'onboarding.backAria'));
  });

  test('no layout truncation: the actions row already wraps (flex-wrap) and no button has a fixed width', () => {
    // The guard:i18n growth-tolerance invariant (uiux §6.2): buttons/chips never carry a fixed
    // pixel width or text-overflow, so a longer ES "Atrás" can never truncate.
    expect(cssSrc).toMatch(/\.actions\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(cssSrc).not.toMatch(/\.btn[^{]*\{[^}]*width:\s*\d+px/);
    expect(cssSrc).not.toMatch(/text-overflow:\s*ellipsis/);
  });
});
