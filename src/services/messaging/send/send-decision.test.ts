// T-37 — the pure send-decision core. Proves the "CFE-cleared AND approved AND unedited" invariant
// that BOTH SMS paths gate on, in isolation from any I/O.

import { CFEOutcome, MessageChannel } from '@prisma/client';

import { isDraftCfeCleared, resolveDraftClearance, type SendDraftFields } from './send-decision';

function draft(overrides: Partial<SendDraftFields> = {}): SendDraftFields {
  return {
    id: 'd-1',
    user_id: 'u-1',
    contact_id: 'c-1',
    channel: MessageChannel.SMS_PLATFORM,
    body: 'Hi there — would love to reconnect.',
    cfe_outcome: CFEOutcome.PASS,
    approval_state: 'APPROVED',
    edited_after_approval: false,
    ...overrides,
  };
}

describe('isDraftCfeCleared — RELEASED verdicts only', () => {
  test('PASS is released', () => {
    expect(isDraftCfeCleared({ cfe_outcome: CFEOutcome.PASS })).toBe(true);
  });
  test('FLAG (adjudicated review band) is released', () => {
    expect(isDraftCfeCleared({ cfe_outcome: CFEOutcome.FLAG })).toBe(true);
  });
  test('BLOCK is NOT released', () => {
    expect(isDraftCfeCleared({ cfe_outcome: CFEOutcome.BLOCK })).toBe(false);
  });
  test('RECORDED (non-CFE audit marker) is NOT released', () => {
    expect(isDraftCfeCleared({ cfe_outcome: CFEOutcome.RECORDED })).toBe(false);
  });
  test('null (never evaluated) is NOT released', () => {
    expect(isDraftCfeCleared({ cfe_outcome: null })).toBe(false);
  });
});

describe('resolveDraftClearance — CFE-cleared + approved + unedited', () => {
  test('PASS + APPROVED + unedited => cleared', () => {
    expect(resolveDraftClearance(draft())).toEqual({ cleared: true });
  });

  test('FLAG + APPROVED + unedited => cleared (flagged content a human approved sends)', () => {
    expect(resolveDraftClearance(draft({ cfe_outcome: CFEOutcome.FLAG }))).toEqual({ cleared: true });
  });

  test('BLOCK => NOT_CFE_CLEARED — even if (impossibly) marked APPROVED, CFE clearance is checked FIRST', () => {
    expect(resolveDraftClearance(draft({ cfe_outcome: CFEOutcome.BLOCK }))).toEqual({
      cleared: false,
      reason: 'NOT_CFE_CLEARED',
    });
  });

  test('null outcome => NOT_CFE_CLEARED', () => {
    expect(resolveDraftClearance(draft({ cfe_outcome: null }))).toEqual({
      cleared: false,
      reason: 'NOT_CFE_CLEARED',
    });
  });

  test('PASS but PENDING (not yet approved) => NOT_APPROVED', () => {
    expect(resolveDraftClearance(draft({ approval_state: 'PENDING' }))).toEqual({
      cleared: false,
      reason: 'NOT_APPROVED',
    });
  });

  test('PASS but HELD => NOT_APPROVED', () => {
    expect(resolveDraftClearance(draft({ approval_state: 'HELD' }))).toEqual({
      cleared: false,
      reason: 'NOT_APPROVED',
    });
  });

  test('APPROVED but edited-after-approval => EDITED_AFTER_APPROVAL (§18.1 must re-enter CFE)', () => {
    expect(resolveDraftClearance(draft({ edited_after_approval: true }))).toEqual({
      cleared: false,
      reason: 'EDITED_AFTER_APPROVAL',
    });
  });
});
