'use client';

// WP01 §5.1 (uiux) — the O-1..O-9 onboarding orchestrator (T-20). Drives the pure `flow-model`
// step machine and renders each O-screen component, so the cinematic rep flow (Flow A) and the
// dense upline/RVP track (Flow B/D) are actually reachable and resume-exact. The screens consume
// the T-17/T-18/T-19 engines via their public types/pure functions; this shell owns only local UI
// state and step advancement (the server-side persistence/gate live in the API layer). The Seven
// Whys turns are produced locally from the engine's `SevenWhysRenderedTurn` shape — which
// structurally cannot carry a score — so the invisible-resonance contract holds by construction.

import { IntensitySetting, OrgType, Role } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

import { useLocale } from '@/app/locale-context';
import { errorDisplay } from '@/lib/i18n/error-display';
import {
  isNativeContactsPlatform,
  nativeClientPlatform,
  nativeContactSourceForPlatform,
  nativeContactsPlugin,
} from '@/lib/native/capacitor-contacts';
import { MAX_IMPORT_ROWS } from '@/services/warm-market/vault/csv-parser';
import type { NativeContactCandidate } from '@/services/warm-market/vault/native-contacts-adapter';
import { runNativeContactsDiscovery } from '@/services/warm-market/vault/native-import-flow';
import { SevenWhysLevel, type SevenWhysRenderedTurn } from '@/services/onboarding/wp01/seven-whys';
import { matchSponsor, type SponsorMatchOutcome } from '@/services/onboarding/wp01/sponsor-matching';
import { checkSolutionNumberForOrg } from '@/services/onboarding/wp01/solution-number';
import { computeHiddenEarnings, type HiddenEarningsResult } from '@/services/warm-market/hidden-earnings';
import type { LicensingState } from '@/services/compliance/licensing';

import ContactImportStep, { type ImportBeat } from './components/ContactImportStep';
import First48Handoff from './components/First48Handoff';
import GdprConsentStep from './components/GdprConsentStep';
import HiddenEarningsReveal from './components/HiddenEarningsReveal';
import IdentityStep, { type PhotoCaptureState } from './components/IdentityStep';
import IntensityDial from './components/IntensityDial';
import OrgStep from './components/OrgStep';
import SevenWhysConversation from './components/SevenWhysConversation';
import SponsorStep from './components/SponsorStep';
import UplineTrack from './components/UplineTrack';
import VisionSplash from './components/VisionSplash';
import {
  nextScreen,
  trackKindForRole,
  type OnboardingScreen,
} from './flow-model';
import styles from './onboarding.module.css';

// One warm, digit-free prompt per Seven Whys level (§5.1 O-5). A low resonance never surfaces here
// as a number — the engine's rendered turn has no score field, and a re-prompt is a caring re-ask.
const SEVEN_WHYS_QUESTIONS: Record<SevenWhysLevel, string> = {
  [SevenWhysLevel.GOAL]: 'What do you want most from building this?',
  [SevenWhysLevel.URGENCY]: 'Why does that matter to you right now?',
  [SevenWhysLevel.HISTORY]: 'Have you tried to change this before?',
  [SevenWhysLevel.CHALLENGE]: "What's gotten in the way until now?",
  [SevenWhysLevel.FEAR]: 'What are you afraid happens if nothing changes?',
  [SevenWhysLevel.TRANSFORMATION]: "Who do you become once you've got this handled?",
  [SevenWhysLevel.COMMITMENT]: 'Are you ready to commit to the work it takes?',
};
const SEVEN_WHYS_ORDER: SevenWhysLevel[] = [
  SevenWhysLevel.GOAL,
  SevenWhysLevel.URGENCY,
  SevenWhysLevel.HISTORY,
  SevenWhysLevel.CHALLENGE,
  SevenWhysLevel.FEAR,
  SevenWhysLevel.TRANSFORMATION,
  SevenWhysLevel.COMMITMENT,
];

export interface OnboardingFlowProps {
  /** Where to start — resolved from the persisted step for a returning rep (resume-exact). */
  initialScreen?: OnboardingScreen;
  /** The rep's role; REP runs the cinematic flow, UPLINE/RVP/DUAL/ADMIN the dense track. */
  role?: Role;
  /** Dense-track licensure state (upline/RVP), consumed by the T-13-backed `UplineTrack`. */
  licensingState?: LicensingState;
}

export default function OnboardingFlow({
  initialScreen = 'vision',
  role = Role.REP,
  licensingState = 'LICENSED',
}: OnboardingFlowProps) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const [screen, setScreen] = useState<OnboardingScreen>(initialScreen);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [photoState, setPhotoState] = useState<PhotoCaptureState>('unset');
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const [solutionNumber, setSolutionNumber] = useState('');
  const [solutionConfirmed, setSolutionConfirmed] = useState(false);
  const [intensity, setIntensity] = useState<IntensitySetting | null>(null);
  const [whyIndex, setWhyIndex] = useState(0);
  const [whyAnswer, setWhyAnswer] = useState('');
  // AC-5.1-5 (O-5 completion) — local UI state, defaults OFF; T-18's WhySession already defaults
  // use_in_outreach_consent=false and only its own setOutreachConsent may ever flip it, so this is
  // purely the UI surface (no live wiring here, exactly like intensity/solutionNumber above).
  const [outreachConsent, setOutreachConsent] = useState(false);
  const [importBeat, setImportBeat] = useState<ImportBeat>('value');
  const [contactCount, setContactCount] = useState(0);
  // T-R30 (parity GAP 1) — the REAL CSV import's in-flight/error state. `onUseCsv` used to just fake
  // `contactCount=24` with no file ever read (T-51); this now drives an actual file picker → the
  // real Vault ingestion route (see `handleCsvFileSelected` below).
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  // Minted once per import ATTEMPT and reused across retries of that same attempt (§18.5
  // idempotency) — cleared once the attempt actually completes so a later, separate file selection
  // mints a fresh key rather than silently reusing a stale one.
  const csvIdempotencyKeyRef = useRef<string | null>(null);
  // T-58 — the REAL "Import from Phone" state. `onRequestPermission` used to just do
  // `setContactCount(24)` with no OS permission ever asked and no device contact ever read (see
  // `handleRequestNativeContacts` below for the real permission-gated device read + selection list
  // this replaces it with).
  const [nativeCandidates, setNativeCandidates] = useState<NativeContactCandidate[]>([]);
  const [nativeSelectedIds, setNativeSelectedIds] = useState<Set<string>>(new Set());
  const [nativeImporting, setNativeImporting] = useState(false);
  const [nativeImportError, setNativeImportError] = useState<string | null>(null);
  const nativeIdempotencyKeyRef = useRef<string | null>(null);
  // T-21R (§6.10-10) — GDPR consent capture: an explicit affirmative act, defaults OFF. Granting
  // calls the session-authenticated `/api/onboarding/consent` route, which is what actually invokes
  // WP11's `ConsentManager` and sets `User.gdpr_consent = true` (this local state is only the UI's
  // controlled toggle value, the same pattern as every other field above).
  const [gdprConsented, setGdprConsented] = useState(false);
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  // Sponsor outcome consumed straight from the §6.5 matcher — with no candidate pool the rep is
  // waitlisted (never a dead end); the UI renders that verdict, it does not decide it.
  const sponsorOutcome: SponsorMatchOutcome = useMemo(
    () => matchSponsor({ orgType: orgType ?? OrgType.EXTERNAL, candidates: [] }),
    [orgType]
  );

  // T-24 (§7.3/§8.4) — the O-8 Reveal's figure, computed by the ONE Hidden Earnings engine rather
  // than inline arithmetic (the pre-T-24 code here computed `contactCount * 5200` etc., which was
  // neither the spec's universal formula nor org-gated for Primerica — both fixed by routing through
  // `computeHiddenEarnings`). `hasValidSolutionNumber` mirrors the same live format check `OrgStep`
  // already renders (§6.3: 7-digit, format-checked) — the Primerica branch only calibrates once a
  // confirmed, format-valid number is on file; a Primerica user who hasn't entered one yet still
  // gets the universal formula (§8.4's own "replacing... when a valid solution number is present").
  const hiddenEarnings: HiddenEarningsResult = useMemo(
    () =>
      computeHiddenEarnings({
        contactCount,
        orgType: orgType ?? OrgType.EXTERNAL,
        hasValidSolutionNumber:
          solutionConfirmed && checkSolutionNumberForOrg(orgType ?? OrgType.EXTERNAL, solutionNumber).formatValid,
      }),
    [contactCount, orgType, solutionConfirmed, solutionNumber]
  );

  // The current Seven Whys turn, built from the engine's rendered-turn shape (no score field).
  const whyTurn: SevenWhysRenderedTurn = useMemo(() => {
    const complete = whyIndex >= SEVEN_WHYS_ORDER.length;
    return {
      filledLevels: SEVEN_WHYS_ORDER.slice(0, whyIndex),
      pulsingLevel: null,
      question: complete ? null : SEVEN_WHYS_QUESTIONS[SEVEN_WHYS_ORDER[whyIndex]],
      acknowledgment: whyIndex > 0 && !complete ? 'Thank you for sharing that.' : null,
      reprompt: false,
      complete,
      anchorStatement: complete ? 'You build so the people you love never have to worry.' : null,
    };
  }, [whyIndex]);

  function advance() {
    const next = nextScreen(screen);
    if (next) setScreen(next);
    // T-R28 (uiux AC-2-1): land directly on Today/Mission Control, not the retired `/dashboard`
    // demo stub — this comment already said "lands on Today" before the route matched that.
    else router.push('/today');
  }

  // T-21R (§6.10-10) — the ONLY call site that actually grants GDPR consent: hits the live,
  // session-authenticated route, which calls WP11's `ConsentManager` and durably records the
  // versioned/timestamped `ComplianceConsent` row + `User.gdpr_consent = true`. Never advances past
  // this screen on a failed request — a rep who never actually consented never reaches `first48`
  // (and, independently, `/api/onboarding/complete` also refuses completion without a recorded
  // consent — this is not the only enforcement point).
  async function handleGrantGdprConsent() {
    setConsentSubmitting(true);
    setConsentError(null);
    try {
      const response = await fetch('/api/onboarding/consent', { method: 'POST' });
      if (!response.ok) {
        // T-57 RE-GATE B [af7789d3] Finding 1 — never render the raw English `body.error`; resolve
        // a locale-correct string from the `errors.*` catalog by the response's machine `code`
        // (falls back to `errors.generic` for the generic session/RBAC-gate failure, which sets no
        // `code` of its own — still real, translated Spanish, never English).
        const body = await response.json().catch(() => ({}) as { code?: string });
        setConsentError(errorDisplay(t, body.code));
        return;
      }
      advance();
    } catch {
      setConsentError(t('onboarding.gdprConsent.failedGeneric'));
    } finally {
      setConsentSubmitting(false);
    }
  }

  // T-R30 (parity GAP 1) — the O-7 "Import a CSV" real handler, extracted from the ORIGINAL file-
  // input `onChange` (below) so BOTH the file-input path AND the T-57 C5 drag-and-drop zone (the
  // desktop/pointer-capable "Full" parity affordance, uiux §6.3) share exactly one read+POST+
  // idempotency-key path — never a second, hand-copied import flow that could drift from the real
  // one. Reads the selected/dropped file as text and POSTs it to the REAL onboarding-time Vault
  // ingestion route (session-gated, NOT onboarding-complete-gated — see that route's own file header
  // for why it can't be `/api/contacts/import`). `contactCount` is set from the route's actual
  // `importedCount + mergedCount` — never a fake constant. A failed import never advances the screen
  // and never fabricates a count; the rep can retry or fall back to "Add one at a time".
  async function processCsvFile(file: File) {
    setCsvError(null);
    setCsvImporting(true);
    if (!csvIdempotencyKeyRef.current) {
      csvIdempotencyKeyRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `csv-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    try {
      const csvText = await file.text();
      const response = await fetch('/api/onboarding/contacts-import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csvText, idempotencyKey: csvIdempotencyKeyRef.current }),
      });
      const body = await response.json().catch(() => ({}) as { code?: string });
      if (!response.ok) {
        // T-57 RE-GATE B [af7789d3] Finding 1 — never render the raw English `body.error`; resolve
        // a locale-correct string from the `errors.*` catalog by the route's machine `code`.
        setCsvError(errorDisplay(t, body.code, { maxRows: MAX_IMPORT_ROWS }));
        return;
      }
      // This attempt is done — a later, separate file selection mints a fresh idempotency key.
      csvIdempotencyKeyRef.current = null;
      const result = body as { importedCount?: number; mergedCount?: number };
      setContactCount((result.importedCount ?? 0) + (result.mergedCount ?? 0));
      advance();
    } catch {
      setCsvError(t('onboarding.contactImport.denied.importFailedGeneric'));
    } finally {
      setCsvImporting(false);
    }
  }

  async function handleCsvFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same filename on a retry
    if (!file) return;
    await processCsvFile(file);
  }

  // T-58 — the real "Import from Phone" dedupe surface: the rep's already-imported Vault contacts'
  // normalized phone/email (never full PII — see the route's own doc comment), read BEFORE the
  // device contacts so `native-contacts-adapter.ts`'s dedupe can flag a candidate the rep already
  // has. A failed/unreachable fetch degrades to "no known existing contacts" (nothing is marked a
  // duplicate) rather than blocking the import attempt — dedupe is a UX nicety here; the SERVER'S own
  // merge-on-duplicate (VaultService.upsertRow) is the actual authority and never skipped.
  async function fetchExistingContactKeys(): Promise<{ phone: string | null; email: string | null }[]> {
    try {
      const response = await fetch('/api/onboarding/contacts-import');
      if (!response.ok) return [];
      const body = (await response.json()) as { contacts?: { phone: string | null; email: string | null }[] };
      return body.contacts ?? [];
    } catch {
      return [];
    }
  }

  // T-58 — the REAL "Connect my contacts" handler, replacing the old
  // `onRequestPermission={() => { setContactCount(24); advance(); }}` fake (no permission ever
  // asked, no device contact ever read). Three fail-closed branches, matching
  // `native-import-flow.ts`'s `NativeImportOutcome`:
  //   - not a native shell at all → 'unsupported' beat, the plugin is never even called (its own web
  //     fallback throws `unimplemented` for every method — this never gives it the chance to).
  //   - OS permission never resolves granted/limited → 'denied' beat, CSV/manual fallback offered,
  //     NO contact is read let alone created.
  //   - granted → the real device read, mapped + deduped, presented on the 'select' beat for the
  //     rep to choose from; nothing is imported until `handleConfirmNativeImport` fires.
  async function handleRequestNativeContacts() {
    setNativeImportError(null);
    const isNative = isNativeContactsPlatform();
    if (!isNative) {
      setImportBeat('unsupported');
      return;
    }

    setImportBeat('permission');
    const existing = await fetchExistingContactKeys();
    const outcome = await runNativeContactsDiscovery({
      isNativePlatform: isNative,
      plugin: nativeContactsPlugin,
      existing,
    });

    if (outcome.kind === 'unsupported') {
      setImportBeat('unsupported');
      return;
    }
    if (outcome.kind === 'denied') {
      setImportBeat('denied');
      return;
    }
    if (outcome.kind === 'error') {
      setNativeImportError(t('onboarding.contactImport.denied.nativeImportFailedGeneric'));
      setImportBeat('denied');
      return;
    }

    setNativeCandidates(outcome.candidates);
    // Pre-check every NON-duplicate candidate (the common case: a first-time import) — a flagged
    // duplicate is still shown (never hidden) but starts unchecked, since it's very likely already
    // in the rep's community; the rep can still check it (harmless — the server merges safely).
    setNativeSelectedIds(new Set(outcome.candidates.filter((c) => !c.isDuplicate).map((c) => c.contactId)));
    setImportBeat('select');
  }

  function handleToggleNativeCandidate(contactId: string) {
    setNativeSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  function handleSelectAllNative() {
    setNativeSelectedIds(new Set(nativeCandidates.map((c) => c.contactId)));
  }

  function handleDeselectAllNative() {
    setNativeSelectedIds(new Set());
  }

  function handleCancelNativeSelection() {
    setNativeCandidates([]);
    setNativeSelectedIds(new Set());
    setNativeImportError(null);
    setImportBeat('preview');
  }

  // T-58 — the rep's explicit "import these" confirmation. POSTs ONLY the checked candidates'
  // already-mapped rows to the real onboarding-time ingestion route (same Vault pipeline as CSV —
  // AES-256-GCM encryption, keyed-HMAC dedupe, minors gate). `contactCount` is set from the route's
  // actual `importedCount + mergedCount`, never a fake constant.
  async function handleConfirmNativeImport() {
    const selectedRows = nativeCandidates
      .filter((c) => nativeSelectedIds.has(c.contactId))
      .map((c) => c.row);
    if (selectedRows.length === 0) return;

    const clientPlatform = nativeClientPlatform();
    const source = nativeContactSourceForPlatform(clientPlatform);
    if (!source) {
      // Web can never reach a real 'select' beat (handleRequestNativeContacts routes it to
      // 'unsupported' first) — this is an unreachable-in-practice belt-and-suspenders check, never a
      // silent import under a forged/invalid source.
      setNativeImportError(t('onboarding.contactImport.denied.nativeImportFailedGeneric'));
      setImportBeat('unsupported');
      return;
    }

    setNativeImporting(true);
    setNativeImportError(null);
    if (!nativeIdempotencyKeyRef.current) {
      nativeIdempotencyKeyRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `native-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    try {
      const response = await fetch('/api/onboarding/contacts-import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source,
          contacts: selectedRows,
          clientPlatform,
          idempotencyKey: nativeIdempotencyKeyRef.current,
        }),
      });
      const body = await response.json().catch(() => ({}) as { code?: string });
      if (!response.ok) {
        setNativeImportError(errorDisplay(t, (body as { code?: string }).code, { maxRows: MAX_IMPORT_ROWS }));
        setImportBeat('denied');
        return;
      }
      // This attempt is done — a later, separate device read/selection mints a fresh idempotency key.
      nativeIdempotencyKeyRef.current = null;
      const result = body as { importedCount?: number; mergedCount?: number };
      setContactCount((result.importedCount ?? 0) + (result.mergedCount ?? 0));
      setNativeCandidates([]);
      setNativeSelectedIds(new Set());
      advance();
    } catch {
      setNativeImportError(t('onboarding.contactImport.denied.nativeImportFailedGeneric'));
      setImportBeat('denied');
    } finally {
      setNativeImporting(false);
    }
  }

  // T-57 C5 (uiux §6.3 "Full" desktop parity) — the drag-and-drop CSV drop zone. The affordance
  // itself is CSS-gated to pointer-capable/wide viewports (`.csvDropZone`'s `display: none` default,
  // lifted only under `(hover: hover) and (pointer: fine) and (min-width: 860px)` in
  // onboarding.module.css) — a touch-only/narrow viewport never sees the hint text, matching this
  // codebase's canonical ≥860 breakpoint (uiux §2.2) for "desktop-class" affordances. The handlers
  // below are harmless to attach unconditionally: a touch device simply never fires `dragover`/
  // `drop` events, so there is no functional difference, only a hidden hint on narrow viewports.
  const [csvDragActive, setCsvDragActive] = useState(false);

  function handleCsvDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setCsvDragActive(true);
  }

  function handleCsvDragLeave() {
    setCsvDragActive(false);
  }

  function handleCsvDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setCsvDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processCsvFile(file);
  }

  // Dense upline/RVP track (Flow B/D): one shell, density not cinema — no vision splash, no reveal.
  if (trackKindForRole(role) === 'dense') {
    return (
      <main className={styles.onboarding}>
        <UplineTrack role={role} licensingState={licensingState} onFinish={() => router.push('/today')} />
      </main>
    );
  }

  return (
    <main className={styles.onboarding}>
      {screen === 'vision' && <VisionSplash onBegin={advance} />}

      {screen === 'identity' && (
        <IdentityStep
          name={name}
          email={email}
          onNameChange={setName}
          onEmailChange={setEmail}
          photoState={photoState}
          onTakePhoto={() => setPhotoState('chosen')}
          onChooseFromLibrary={() => setPhotoState('chosen')}
          onSkipPhoto={() => {
            setPhotoState('skipped');
            advance();
          }}
          onContinue={advance}
        />
      )}

      {screen === 'org' && (
        <OrgStep
          selectedOrgType={orgType}
          onSelectOrgType={(o) => {
            setOrgType(o);
            setSolutionConfirmed(false);
          }}
          solutionNumber={solutionNumber}
          onSolutionNumberChange={setSolutionNumber}
          confirmed={solutionConfirmed}
        />
      )}
      {screen === 'org' && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!orgType}
            onClick={() => {
              if (orgType === OrgType.PRIMERICA && solutionNumber && !solutionConfirmed) {
                setSolutionConfirmed(true);
              }
              advance();
            }}
          >
            {t('onboarding.continueCta')}
          </button>
        </div>
      )}

      {screen === 'goals_intensity' && (
        <IntensityDial value={intensity} onChange={setIntensity} onContinue={advance} />
      )}

      {screen === 'seven_whys' && (
        <SevenWhysConversation
          turn={whyTurn}
          answer={whyAnswer}
          onAnswerChange={setWhyAnswer}
          onSubmit={() => {
            setWhyAnswer('');
            setWhyIndex((i) => i + 1);
          }}
          outreachConsent={outreachConsent}
          onOutreachConsentChange={setOutreachConsent}
        />
      )}
      {screen === 'seven_whys' && whyTurn.complete && (
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={advance}>
            {t('onboarding.continueCta')}
          </button>
        </div>
      )}

      {screen === 'sponsor' && (
        <SponsorStep
          outcome={sponsorOutcome}
          // T-R32b — was a hardcoded `sponsorName="Your sponsor"` literal, which shadowed
          // `SponsorStep`'s own (now-localized) `sponsorName ?? t('onboarding.sponsor.fallbackName')`
          // default with an always-English value regardless of locale. Omitted so that child default
          // applies — identical EN behavior, genuinely translated under `es`.
          onAccept={advance}
          onJoinWaitlist={advance}
          onStartPaid={advance}
          onNoUplineYet={advance}
        />
      )}

      {screen === 'contacts' && (
        <>
          <ContactImportStep
            beat={importBeat}
            onAdvance={() => (importBeat === 'value' ? setImportBeat('preview') : advance())}
            // T-58: the REAL permission-gated device-contacts flow — no more faked contactCount=24.
            // See handleRequestNativeContacts's own doc comment for the three fail-closed branches.
            onRequestPermission={handleRequestNativeContacts}
            onDeny={() => setImportBeat('denied')}
            // T-R30 (parity GAP 1): opens the REAL OS file picker — no more faked contactCount.
            // `handleCsvFileSelected` (the input's onChange, below) does the actual read+import.
            onUseCsv={() => csvInputRef.current?.click()}
            onAddManually={() => {
              setContactCount(1);
              advance();
            }}
            csvImporting={csvImporting}
            csvError={csvError}
            nativeCandidates={nativeCandidates}
            nativeSelectedIds={nativeSelectedIds}
            onToggleNativeCandidate={handleToggleNativeCandidate}
            onSelectAllNative={handleSelectAllNative}
            onDeselectAllNative={handleDeselectAllNative}
            onConfirmNativeImport={handleConfirmNativeImport}
            onCancelNativeSelection={handleCancelNativeSelection}
            nativeImporting={nativeImporting}
            nativeImportError={nativeImportError}
          />
          {/* T-57 C5 (uiux §6.3 "Full" desktop parity) — drag-and-drop CSV zone, additive alongside
              the "Import a CSV" button above (never a replacement — the button is the only CSV path
              on touch/narrow viewports, where this hint is CSS-hidden). Only meaningful once the CSV
              path is actually offered (the 'denied' beat, mirroring ContactImportStep's own gating
              of the "Import a CSV" button to that same beat). */}
          {importBeat === 'denied' && (
            <div
              className={styles.csvDropZone}
              data-drag-active={csvDragActive}
              onDragOver={handleCsvDragOver}
              onDragLeave={handleCsvDragLeave}
              onDrop={handleCsvDrop}
            >
              {t('onboarding.contactImport.denied.dragDropHint')}
            </div>
          )}
          {/* Visually hidden (not display:none, so the ref's programmatic .click() stays reliable
              cross-browser) — triggered ONLY by the "Import a CSV" button above via csvInputRef. */}
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label={t('onboarding.contactImport.csvFileInputAria')}
            className={styles.srOnly}
            onChange={handleCsvFileSelected}
          />
        </>
      )}

      {screen === 'reveal' && (
        <HiddenEarningsReveal
          contactCount={contactCount}
          monthlyValueUsd={hiddenEarnings.kind === 'figure' ? hiddenEarnings.estimatedMonthlyValueUsd : 0}
          estimatedAppointments={hiddenEarnings.kind === 'figure' ? hiddenEarnings.estimatedAppointments : 0}
          estimatedClients={hiddenEarnings.kind === 'figure' ? hiddenEarnings.estimatedClients : 0}
          onContinue={advance}
          onAddContacts={() => setScreen('contacts')}
          locale={locale}
        />
      )}

      {screen === 'consent' && (
        <GdprConsentStep
          consented={gdprConsented}
          onConsentedChange={setGdprConsented}
          onContinue={handleGrantGdprConsent}
          submitting={consentSubmitting}
          error={consentError}
        />
      )}

      {screen === 'first48' && <First48Handoff onShowToday={() => router.push('/today')} />}
    </main>
  );
}
