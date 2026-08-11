// R-04 (refinements catalog 2026-07-28) — the O-2 photo step must NEVER auto-skip/forward past the
// photo, must offer real upload SOURCE options (camera / photo library / browse files — a standard
// `accept="image/*"` file input with capture affordances per platform), must be REACHABLE via the
// R-03 back navigation once skipped, and must preserve the identity step's name/email persistence.
//
// The pre-fix step's "Take a photo" / "Choose from library" buttons only faked
// `photoState='chosen'` (no file input existed at all — no source choice, and the operator was
// forwarded on with the photo never actually captured). This suite proves the fix from four angles:
//
//   (1) RENDER (IdentityStep, react-dom/server) — the three source affordances (Take a photo /
//       Photo library / Browse files) plus an explicit Skip render alongside name+email, backed by
//       ONE standard file input (`accept="image/*"`); a chosen file renders the real preview + file
//       name and swaps the source buttons for Remove; the initials-avatar fallback renders for
//       unset and skipped states (no blank/broken slot).
//
//   (2) BEHAVIOR (mounted shell, react-test-renderer — the r03-back-nav precedent) — the photo
//       step does NOT advance when a photo is picked NOR when Skip is pressed: both are local
//       state changes, and Continue is the ONLY way past the step. Skip renders the initials
//       avatar and Continue still walks forward with the saved name/email intact.
//
//   (3) WIRING (source-scan) — the skip handler in OnboardingFlow is a pure `setPhotoState` call
//       (no advance/handleIdentityAdvance anywhere on the skip path); the chosen file flows
//       through `handlePhotoFileSelected` (which mints/revokes the preview URL); the file input
//       carries `accept="image/*"` and the camera source sets `capture="user"` while library and
//       files omit it (the platform resolves library/files per its own capability).
//
//   (4) REACHABILITY + i18n — `prevScreenForRole` walks back from `org` onto `identity` (R-03),
//       and every new label exists in BOTH catalogs with genuinely different (non-English) ES.
//
// FAIL-CLOSED CONTRACT UNDER TEST: picking or skipping a photo NEVER advances the step and NEVER
// fires a server call; only Continue (handleIdentityAdvance) does. Dense (upline/RVP) tracks
// never render the identity screen at all — this change is rep-track-only.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Role } from '@prisma/client';
import { createElement, type ReactElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

import { prevScreenForRole, type OnboardingScreen } from '@/app/onboarding/flow-model';

const REPO = path.join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');
const flowSrc = read('src/app/onboarding/OnboardingFlow.tsx');
const identitySrc = read('src/app/onboarding/components/IdentityStep.tsx');

const enCatalog = JSON.parse(read('src/lib/i18n/messages/en.json')) as Record<string, unknown>;
const esCatalog = JSON.parse(read('src/lib/i18n/messages/es.json')) as Record<string, unknown>;
const get = (tree: { [k: string]: unknown }, p: string): string | undefined =>
  p.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as { [k: string]: unknown })[part];
  }, tree) as string | undefined;

// ─── 1. Render contracts (IdentityStep, static markup) ────────────────────────────────────────────

import IdentityStep from '@/app/onboarding/components/IdentityStep';

const render = (el: ReactElement) => renderToStaticMarkup(el);
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');

describe('R-04 render — the source chooser + explicit skip + real preview', () => {
  test('all three SOURCE options and the explicit Skip render alongside name+email (no auto-advance affordance)', () => {
    const html = render(createElement(IdentityStep, { name: 'Jane Doe', email: 'jane@example.com' }));
    expect(textOf(html)).toMatch(/take a photo/i);
    expect(textOf(html)).toMatch(/photo library/i);
    expect(textOf(html)).toMatch(/browse files/i);
    expect(textOf(html)).toMatch(/skip photo/i);
    // One standard file input, image-only — the capture affordance per platform capability.
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*"');
    // The identity screen renders NO advance button other than the shared Continue.
    expect(textOf(html)).toContain('Continue');
  });

  test('a chosen file renders the caller-minted real preview + file name; Remove replaces the source buttons', () => {
    const html = render(
      createElement(IdentityStep, {
        name: 'Jane Doe',
        email: 'jane@example.com',
        photoState: 'chosen',
        photoFileName: 'jane.jpg',
        photoPreviewUrl: 'blob:nodedata:preview-1',
      })
    );
    expect(html).toContain('src="blob:nodedata:preview-1"');
    expect(textOf(html)).toContain('jane.jpg added');
    expect(textOf(html)).toContain('Remove photo');
    expect(textOf(html)).not.toMatch(/take a photo|photo library|browse files|skip photo/i);
    expect(html).not.toContain('aria-label="Initials avatar: JD"');
  });

  test('unset and skipped states both render the initials-avatar fallback — never a blank slot', () => {
    const unset = render(createElement(IdentityStep, { name: 'Jane Doe', email: 'jane@example.com' }));
    expect(unset).toContain('aria-label="Initials avatar: JD"');
    const skipped = render(
      createElement(IdentityStep, { name: 'Jane Doe', email: 'jane@example.com', photoState: 'skipped' })
    );
    expect(skipped).toContain('aria-label="Initials avatar: JD"');
  });
});

// ─── 2. Behavior: the mounted shell never auto-advances on pick or skip ───────────────────────────

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

function textOfTree(tree: TestRenderer.ReactTestRenderer): string {
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

function photoFileInput(tree: TestRenderer.ReactTestRenderer) {
  const input = tree.root.findAll((n) => n.type === 'input').find((n) => (n.props as { type?: string }).type === 'file');
  return input as unknown as {
    props: { onChange: (e: { target: { files?: File[]; value: string } }) => void };
  };
}

describe('R-04 behavior — the photo step stays put until the rep acts', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/onboarding/status') return okJson({}); // no session — start fresh
      if (url === '/api/onboarding/step') {
        return okJson({ currentStep: 'ROLE_ORG_CONTEXT', completed: false });
      }
      return okJson({});
    });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  test('picking a photo does NOT advance the step — the rep stays on identity with their photo captured', () => {
    const tree = mountFlow('identity');
    act(() => {
      nameInput(tree).props.onChange({ target: { value: 'Alex Rivera' } });
    });
    act(() => {
      photoFileInput(tree).props.onChange({
        target: { files: [new File(['x'], 'alex.png', { type: 'image/png' })], value: '' },
      });
    });
    // Still on the identity screen — photo captured, no auto-forward.
    expect(textOfTree(tree)).toContain("Let's get your details".replace("'", '’'));
    expect(textOfTree(tree)).toContain('alex.png added');
    expect(textOfTree(tree)).not.toContain("Let's begin"); // vision splash — not forwarded there
  });

  test('Skip photo is an EXPLICIT act: it records the skip (initials avatar) and does NOT advance', () => {
    const tree = mountFlow('identity');
    act(() => {
      nameInput(tree).props.onChange({ target: { value: 'Alex Rivera' } });
    });
    act(() => {
      buttonWithText(tree, 'Skip photo')!.props.onClick();
    });
    // Still on the identity screen, initials avatar (AR) rendered — skip recorded, no forward.
    expect(textOfTree(tree)).toContain("Let's get your details".replace("'", '’'));
    expect(textOfTree(tree)).toContain('Initials avatar: AR');
    expect(textOfTree(tree)).not.toContain('Photo added');
  });

  test('after a skip, Continue is the only way forward — and name/email walk forward intact', async () => {
    const tree = mountFlow('identity');
    act(() => {
      nameInput(tree).props.onChange({ target: { value: 'Alex Rivera' } });
    });
    const emailInput = tree.root
      .findAll((n) => n.type === 'input')
      .find((n) => (n.props as { id?: string }).id === 'identity-email') as unknown as {
      props: { onChange: (e: { target: { value: string } }) => void };
    };
    act(() => {
      emailInput.props.onChange({ target: { value: 'alex@example.com' } });
    });
    act(() => {
      buttonWithText(tree, 'Skip photo')!.props.onClick();
    });
    expect(textOfTree(tree)).toContain('Alex Rivera'); // still on identity, data intact
    expect(textOfTree(tree)).toContain('alex@example.com');

    // Only Continue advances — and the identity chain still POSTs REGISTER/ACCOUNT_TYPE once.
    await act(async () => {
      buttonWithText(tree, 'Continue')!.props.onClick();
    });
    // Landed on the O-3 org-context screen (REP walk).
    expect(textOfTree(tree)).toContain('You’re building independently');
    expect(textOfTree(tree)).not.toContain("Let's get your details".replace("'", '’'));
  });

  test('a back press from a later step returns to the SKIPPED photo step (R-03 reachability), name/email intact', async () => {
    const tree = mountFlow('org');
    // Back from O-3 lands on the O-2 identity step (R-03 walk: org → identity).
    act(() => {
      buttonWithText(tree, 'Back')!.props.onClick();
    });
    expect(textOfTree(tree)).toContain("Let's get your details".replace("'", '’'));
    expect(textOfTree(tree)).toContain('Skip photo');

    // Skip + Continue again walk forward; nothing was wiped by the round trip.
    act(() => {
      buttonWithText(tree, 'Skip photo')!.props.onClick();
    });
    await act(async () => {
      buttonWithText(tree, 'Continue')!.props.onClick();
    });
    expect(textOfTree(tree)).toContain('You’re building independently');
  });

  test('the dense (UPLINE) track never renders the identity photo screen — R-04 is rep-track-only', () => {
    const tree = mountFlow('org', Role.UPLINE);
    // Dense track ignores the rep O-screens entirely (checklist surface renders).
    expect(textOfTree(tree)).not.toContain("Let's get your details".replace("'", '’'));
    expect(textOfTree(tree)).not.toContain('Skip photo');
  });
});

// ─── 3. Wiring: source-scan proofs ────────────────────────────────────────────────────────────────

describe('R-04 wiring — skip never advances, sources drive ONE file input, preview URL lifecycle', () => {
  test('the skip handler in OnboardingFlow is a pure setPhotoState call — NO advance anywhere on the skip path', () => {
    const identityBlock = flowSrc.split("{screen === 'identity' && (")[1]?.split('{screen === \'org\'')[0] ?? '';
    const skipIndex = identityBlock.indexOf('onSkipPhoto');
    expect(skipIndex).toBeGreaterThan(-1);
    // The skip prop is a one-liner: only setPhotoState('skipped') — the R-03-era silent
    // auto-advance (`setPhotoState('skipped'); handleIdentityAdvance()`) is GONE.
    const skipLine = identityBlock.slice(skipIndex, identityBlock.indexOf('\n', skipIndex));
    expect(skipLine).toContain("setPhotoState('skipped')");
    expect(skipLine).not.toContain('handleIdentityAdvance');
    expect(skipLine).not.toContain('advance(');
    // And the identity screen's only advance affordance is Continue → handleIdentityAdvance.
    expect(identityBlock).toContain('onContinue={() => void handleIdentityAdvance()}');
  });

  test('the chosen file flows through handlePhotoFileSelected, which mints AND revokes the preview URL', () => {
    expect(flowSrc).toContain('function handlePhotoFileSelected(file: File)');
    expect(flowSrc).toContain('URL.createObjectURL(file)');
    expect(flowSrc).toContain('URL.revokeObjectURL(photoPreviewUrl)');
    expect(flowSrc).toContain('setPhotoFileName(file.name)');
    expect(flowSrc).toContain("setPhotoState('chosen')");
    // Remove clears the preview + file name and returns to 'unset'.
    expect(flowSrc).toContain('function handleRemovePhoto()');
    expect(flowSrc).toContain('setPhotoPreviewUrl(null)');
    expect(flowSrc).toContain('setPhotoFileName(null)');
    expect(flowSrc).toContain("setPhotoState('unset')");
    // The identity screen passes the new props through.
    expect(flowSrc).toContain('photoFileName={photoFileName}');
    expect(flowSrc).toContain('photoPreviewUrl={photoPreviewUrl}');
    expect(flowSrc).toContain('onPhotoFileSelected={handlePhotoFileSelected}');
    expect(flowSrc).toContain('onRemovePhoto={handleRemovePhoto}');
  });

  test('IdentityStep: one image-only file input; Camera sets capture="user", library/files do not', () => {
    // The input itself is standard and image-only.
    expect(identitySrc).toContain('type="file"');
    expect(identitySrc).toContain('accept="image/*"');
    // Camera source: setAttribute('capture', 'user'); the others remove it — the platform's own
    // chooser then resolves photo library (touch) or the file browser/Downloads (desktop).
    expect(identitySrc).toContain("if (source === 'camera') input.setAttribute('capture', 'user')");
    expect(identitySrc).toContain('else input.removeAttribute(\'capture\')');
    // All three buttons open the SAME input via the ref (never a second, hand-rolled picker).
    expect(identitySrc).toContain("onClick={() => openPhotoSource('camera')}");
    expect(identitySrc).toContain("onClick={() => openPhotoSource('library')}");
    expect(identitySrc).toContain("onClick={() => openPhotoSource('files')}");
    expect(identitySrc).toContain('input.click()');
  });

  test('a selection never advances: IdentityStep\'s change handler only reports the file upward', () => {
    expect(identitySrc).toContain('if (file) onPhotoFileSelected?.(file)');
    // No advance/continue CALL exists anywhere in the component: the only handler-shaped
    // invocations are the reported-upward callbacks (onPhotoFileSelected / onContinue / skip).
    expect(identitySrc).not.toMatch(/onContinue\?\.\(\)|advance\(\)|handleIdentityAdvance/);
  });
});

// ─── 4. Reachability + i18n ───────────────────────────────────────────────────────────────────────

describe('R-04 reachability + i18n', () => {
  test('the photo (identity) step is reachable via the R-03 back walk from the next step', () => {
    expect(prevScreenForRole(Role.REP, 'org')).toBe('identity');
    expect(prevScreenForRole(Role.RVP, 'org')).toBe('identity');
  });

  test('every new identity key exists in BOTH catalogs with genuinely different (non-English) ES', () => {
    const keys = [
      'photoSourceLabel',
      'takePhotoCta',
      'chooseFromLibraryCta',
      'browseFilesCta',
      'skipPhotoCta',
      'photoChosenCaption',
      'photoPreviewAria',
      'removePhotoCta',
      'photoFileInputAria',
    ] as const;
    for (const key of keys) {
      const en = get(enCatalog, `onboarding.identity.${key}`);
      const es = get(esCatalog, `onboarding.identity.${key}`);
      expect(typeof en).toBe('string');
      expect((en as string).length).toBeGreaterThan(0);
      expect(typeof es).toBe('string');
      expect((es as string).length).toBeGreaterThan(0);
      expect(es).not.toBe(en);
    }
    // The ES copies are genuinely Spanish, not untranslated English labels.
    expect(get(esCatalog, 'onboarding.identity.browseFilesCta')).toBe('Examinar archivos');
    expect(get(esCatalog, 'onboarding.identity.chooseFromLibraryCta')).toBe('Biblioteca de fotos');
    expect(get(esCatalog, 'onboarding.identity.removePhotoCta')).toBe('Quitar foto');
    // The chosen-file caption interpolates the same {fileName} token in both catalogs.
    expect(get(enCatalog, 'onboarding.identity.photoChosenCaption')).toContain('{fileName}');
    expect(get(esCatalog, 'onboarding.identity.photoChosenCaption')).toContain('{fileName}');
  });
});
