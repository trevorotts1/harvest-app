// T-33 — the NO-BATCH-APPROVE architectural guard (master-spec §9.2/§9.9-2/§9.9-3; uiux §5.6
// "Batch operations do not exist by design ... an 'approve all' affordance must never ship",
// AC-5.6-2). Mirrors tests/unit/action-queue-boundary.test.ts's exact style for the analogous T-27
// guard: each test states the mutation that makes it fail — remove `rejectBatchApprove`'s call from
// a route (or delete the guard itself) and these assertions stop passing.

import {
  ApprovalAntiPatternBlockedError,
  rejectBatchApprove,
} from '../../src/services/approval-inbox/approval-boundary';

describe('rejectBatchApprove — §9.2/§9.9-3 "no batch-approve affordance exists"', () => {
  test.each(['draftIds', 'DraftIds', 'DRAFTIDS'])(
    'throws ApprovalAntiPatternBlockedError when the body carries plural "%s" — fails the instant the guard is removed',
    (key) => {
      expect(() => rejectBatchApprove({ [key]: ['d-1', 'd-2'] })).toThrow(ApprovalAntiPatternBlockedError);
      try {
        rejectBatchApprove({ [key]: ['d-1', 'd-2'] });
      } catch (e) {
        expect((e as ApprovalAntiPatternBlockedError).antiPattern).toBe('batch_approve');
      }
    }
  );

  test('throws when draftId is an array instead of a single string', () => {
    expect(() => rejectBatchApprove({ draftId: ['d-1', 'd-2'] })).toThrow(ApprovalAntiPatternBlockedError);
  });

  test('throws when a plain "ids" array is present', () => {
    expect(() => rejectBatchApprove({ ids: ['d-1', 'd-2'] })).toThrow(ApprovalAntiPatternBlockedError);
  });

  test('an empty array still trips the plural-field guard (no "at least one id" escape hatch)', () => {
    expect(() => rejectBatchApprove({ draftIds: [] })).toThrow(ApprovalAntiPatternBlockedError);
  });

  test('a single-string draftId passes through untouched — the legitimate per-item shape', () => {
    expect(() => rejectBatchApprove({ draftId: 'd-1' })).not.toThrow();
    expect(() => rejectBatchApprove({ draftId: 'd-1', reason: 'wrong_time' })).not.toThrow();
  });

  test('null/undefined body is a no-op (route-level JSON-parse failures are handled separately)', () => {
    expect(() => rejectBatchApprove(null)).not.toThrow();
    expect(() => rejectBatchApprove(undefined)).not.toThrow();
  });

  test('case-insensitive + one-level-nested, mirroring T-27\'s own guard scope', () => {
    expect(() => rejectBatchApprove({ draftId: 'd-1', batch: { DraftIds: ['d-1', 'd-2'] } })).toThrow(
      ApprovalAntiPatternBlockedError
    );
    try {
      rejectBatchApprove({ draftId: 'd-1', batch: { DraftIds: ['d-1', 'd-2'] } });
    } catch (e) {
      expect((e as ApprovalAntiPatternBlockedError).antiPattern).toBe('batch_approve');
    }
  });
});
