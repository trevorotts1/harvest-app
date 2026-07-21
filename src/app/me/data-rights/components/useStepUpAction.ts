// T-R29 (compliance-reachability build) — generalizes the enroll -> verify -> step-up -> [retry]
// MFA lifecycle `src/app/grow/components/OrgSwitchPanel.tsx` (WP08) already built inline for
// `org_switch`. Data-rights export/deletion are ALSO step-up-gated `SensitiveAction`s (§16.4, row 8
// of the §16.6 matrix — `data_export`/`data_delete`), and this page needs the SAME lifecycle twice
// (once for export, once for deletion), so it is factored into one hook here rather than duplicated
// — same `/api/auth/mfa/*` routes OrgSwitchPanel already uses, never a second MFA implementation.

import { useCallback, useState } from 'react';
import { useSession } from 'next-auth/react';

export type StepUpStage = 'idle' | 'need_enroll' | 'need_verify' | 'need_step_up' | 'busy' | 'error';

export interface StepUpAction {
  stage: StepUpStage;
  code: string;
  setCode: (code: string) => void;
  otpauthUri: string | null;
  errorMessage: string | null;
  /** Kick off `attempt`; if it reports an MFA gate, walks the enroll/verify/step-up flow, then
   *  retries `attempt` automatically once cleared. */
  run: () => Promise<void>;
  startEnroll: () => Promise<void>;
  submitVerify: () => Promise<void>;
  submitStepUp: () => Promise<void>;
  reset: () => void;
}

/** What `attempt` returns: either the real result, or a signal that an MFA gate blocked it (the
 *  same two codes `/api/auth/mfa/step-up`-gated routes emit — see `with-role.ts`'s `withStepUp`). */
export type StepUpAttemptResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'MFA_ENROLLMENT_REQUIRED' }
  | { ok: false; code: 'STEP_UP_REQUIRED' }
  | { ok: false; code: 'ERROR'; message: string };

export function useStepUpAction<T>(
  attempt: () => Promise<StepUpAttemptResult<T>>,
  onSuccess: (value: T) => void
): StepUpAction {
  const { update } = useSession();
  const [stage, setStage] = useState<StepUpStage>('idle');
  const [code, setCode] = useState('');
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const attemptAndHandle = useCallback(async () => {
    const result = await attempt();
    if (result.ok) {
      setStage('idle');
      setErrorMessage(null);
      onSuccess(result.value);
      return;
    }
    if (result.code === 'MFA_ENROLLMENT_REQUIRED') {
      setStage('need_enroll');
      return;
    }
    if (result.code === 'STEP_UP_REQUIRED') {
      setStage('need_step_up');
      return;
    }
    setErrorMessage(result.message);
    setStage('error');
  }, [attempt, onSuccess]);

  const run = useCallback(async () => {
    setStage('busy');
    await attemptAndHandle();
  }, [attemptAndHandle]);

  const startEnroll = useCallback(async () => {
    setStage('busy');
    const res = await fetch('/api/auth/mfa/enroll', { method: 'POST' });
    if (!res.ok) {
      setErrorMessage('Could not start the security check-up. Nothing was changed.');
      setStage('error');
      return;
    }
    const body = await res.json();
    setOtpauthUri(body.otpauthUri ?? null);
    setStage('need_verify');
  }, []);

  const submitVerify = useCallback(async () => {
    setStage('busy');
    const res = await fetch('/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: code }),
    });
    if (!res.ok) {
      setErrorMessage('That code did not verify — check your authenticator app and try again.');
      setStage('need_verify');
      return;
    }
    setCode('');
    await attemptAndHandle();
  }, [code, attemptAndHandle]);

  const submitStepUp = useCallback(async () => {
    setStage('busy');
    const res = await fetch('/api/auth/mfa/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: code }),
    });
    if (!res.ok) {
      setErrorMessage('That code did not verify — check your authenticator app and try again.');
      setStage('need_step_up');
      return;
    }
    const body = await res.json();
    setCode('');
    await update({ mfaVerifiedAt: body.mfaVerifiedAt });
    await attemptAndHandle();
  }, [code, update, attemptAndHandle]);

  const reset = useCallback(() => {
    setStage('idle');
    setErrorMessage(null);
    setCode('');
  }, []);

  return { stage, code, setCode, otpauthUri, errorMessage, run, startEnroll, submitVerify, submitStepUp, reset };
}
