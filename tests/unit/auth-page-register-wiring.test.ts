// T-R39 — proves the register wizard (src/app/auth/page.tsx) is genuinely wired to
// registerAndSignIn, not the old `<form action="/onboarding">` GET-navigation-with-demo-defaults
// stub. `AuthPage` calls `useRouter()` at render time and its submit handlers only run inside
// event handlers this repo's jsdom-less Jest env (testEnvironment: 'node', no
// @testing-library/react — see auth-page-i18n.test.ts's own header) cannot simulate — so, mirroring
// composer-handoff-wiring.test.ts's established pattern, the WIRING itself is proven by a
// structural source scan; the actual submit/network/navigate BEHAVIOR is proven for real (fetch +
// signIn stubbed, no source-scan involved) in register-client.test.ts, which this component calls
// straight through with no logic of its own duplicated in the JSX.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'auth', 'page.tsx'), 'utf8');

describe('AuthPage register wizard — real account creation, not the demo GET stub (T-R39)', () => {
  test('the hardcoded demo defaults are gone from the actual input elements', () => {
    // Scoped to the real `<input>` attributes (not the header comment above, which legitimately
    // documents the old behavior for traceability) — this is the functional check that a fresh
    // page load no longer pre-fills the demo identity.
    expect(SRC).not.toMatch(/id="name" name="name"[^/]*defaultValue/);
    expect(SRC).not.toMatch(/id="email" name="email"[^/]*defaultValue/);
    expect(SRC).not.toMatch(/defaultValue="Spaulding Demo"/);
    expect(SRC).not.toMatch(/defaultValue="demo@theharvest\.local"/);
  });

  test('the false "still POSTs to /api/auth/register" comment is gone (it genuinely does now)', () => {
    expect(SRC).not.toMatch(/register wizard below is unchanged/);
    expect(SRC).not.toMatch(/successful registration does not itself start a session/);
  });

  test('the register form is a real onSubmit handler, not a GET action to /onboarding', () => {
    expect(SRC).not.toMatch(/<form action="\/onboarding">/);
    expect(SRC).toMatch(/<form onSubmit=\{handleRegister\}>/);
  });

  test('collects name, email, and a real password field (previously absent entirely)', () => {
    expect(SRC).toMatch(/id="name" name="name"/);
    expect(SRC).toMatch(/id="email" name="email" type="email"/);
    expect(SRC).toMatch(/id="password" name="password" type="password"/);
  });

  test('handleRegister imports and calls the real registerAndSignIn orchestration', () => {
    expect(SRC).toMatch(/import \{ registerAndSignIn, type RegisterFields \} from '\.\/register-client'/);
    expect(SRC).toMatch(/registerAndSignIn\(fields,/);
  });

  test('signs in via the real Auth.js Credentials provider (redirect: false, same as login)', () => {
    // Both handleLogin's (multi-line) and handleRegister's (single-line) call sites must use the
    // real Credentials provider with redirect:false — checked independently since their literal
    // formatting differs.
    expect(SRC).toMatch(/signIn\('credentials', \{[\s\S]{0,20}email: loginEmail,[\s\S]{0,40}password: loginPassword,[\s\S]{0,30}redirect: false,?[\s\S]{0,10}\}\)/);
    expect(SRC).toMatch(/signIn\('credentials', \{ email: signInEmail, password: signInPassword, redirect: false \}\)/);
  });

  test('navigates to /onboarding ONLY after registerAndSignIn reports success — the error branch returns first', () => {
    const handlerMatch = SRC.match(/const handleRegister = async[\s\S]*?\n  \};/);
    expect(handlerMatch).not.toBeNull();
    const handlerSrc = handlerMatch![0];

    expect(handlerSrc).toMatch(/router\.push\('\/onboarding'\)/);
    // The error branch must textually precede the navigate call, and must itself `return` —
    // structurally guaranteeing the push is unreachable on a failure.
    const errorBranchIdx = handlerSrc.indexOf("outcome.outcome === 'error'");
    const returnIdx = handlerSrc.indexOf('return;', errorBranchIdx);
    const pushIdx = handlerSrc.indexOf("router.push('/onboarding')");
    expect(errorBranchIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(errorBranchIdx);
    expect(pushIdx).toBeGreaterThan(returnIdx);
  });

  test('renders the honest error through the StatusMessage live-region pattern (never a silent/fake success)', () => {
    expect(SRC).toMatch(/import StatusMessage from '@\/components\/StatusMessage'/);
    expect(SRC).toMatch(/\{registerError \? <StatusMessage>\{registerError\}<\/StatusMessage> : null\}/);
    expect(SRC).toMatch(/setRegisterError\(t\(outcome\.catalogKey\)\)/);
  });

  test('guards double-submit: an early return while pending, and the submit button disables while pending', () => {
    expect(SRC).toMatch(/if \(registerPending\) return;/);
    expect(SRC).toMatch(/disabled=\{registerPending\}/);
  });

  test('the submit body is built from the real submitted fields (FormData), not stray component state defaults', () => {
    expect(SRC).toMatch(/new FormData\(event\.currentTarget\)/);
    expect(SRC).toMatch(/data\.get\('name'\)/);
    expect(SRC).toMatch(/data\.get\('email'\)/);
    expect(SRC).toMatch(/data\.get\('password'\)/);
  });

  test('the login form (mode=login) is untouched and still works', () => {
    expect(SRC).toMatch(/<form onSubmit=\{handleLogin\}>/);
    expect(SRC).toMatch(/signIn\('credentials', \{\s*email: loginEmail,\s*password: loginPassword,\s*redirect: false,\s*\}\)/);
  });
});
