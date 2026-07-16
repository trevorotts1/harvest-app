// WP01 §6.2 — DUAL role persona isolation. Proves QC critical failure (a) is ABSENT: a DUAL user's
// rep-context data/capabilities do NOT bleed into their upline-context views and vice-versa
// ("never blended", §6.2 / §17.2 / uiux §5.9-9).

import { Role } from '@prisma/client';

import {
  PersonaScopedStore,
  canInPersona,
  isDualRole,
  personaScopeKey,
  personasForRole,
  resolveApprovalReviewer,
} from '../../src/services/onboarding/wp01/roles';

describe('WP01 five roles + DUAL persona isolation (§6.2)', () => {
  test('DUAL is the only multi-persona role; REP/UPLINE/RVP are single-persona', () => {
    expect(isDualRole(Role.DUAL)).toBe(true);
    expect(personasForRole(Role.DUAL)).toEqual(['rep', 'upline']);
    expect(personasForRole(Role.REP)).toEqual(['rep']);
    expect(personasForRole(Role.UPLINE)).toEqual(['upline']);
    expect(personasForRole(Role.RVP)).toEqual(['upline']);
  });

  describe('CAPABILITY isolation — acting-as-persona uses ONLY that persona, never the union', () => {
    test('DUAL acting as REP is denied upline-only downline visibility (no upline bleed)', () => {
      // A plain UPLINE can read downline visibility; a plain REP cannot.
      expect(canInPersona(Role.UPLINE, 'upline', 'downline_visibility', 'read')).toBe(true);
      expect(canInPersona(Role.REP, 'rep', 'downline_visibility', 'read')).toBe(false);

      // The DUAL user, WHILE ACTING AS REP, must be exactly as restricted as a REP — the upline
      // capability must NOT bleed in even though the account also holds the upline persona.
      expect(canInPersona(Role.DUAL, 'rep', 'downline_visibility', 'read')).toBe(false);
      // And WHILE ACTING AS UPLINE, they get the upline capability.
      expect(canInPersona(Role.DUAL, 'upline', 'downline_visibility', 'read')).toBe(true);
    });

    test('DUAL acting as UPLINE is denied a rep-only capability path (no rep bleed the other way)', () => {
      // 'contacts' write is a rep-side "own pipeline" capability; team_metrics is upline-side.
      // Acting as UPLINE, the DUAL user gets team_metrics but not the rep-persona's own-contacts write
      // scope leaking cross-persona: prove the persona flips the effective role cleanly.
      expect(canInPersona(Role.DUAL, 'upline', 'team_metrics', 'read')).toBe(true);
      expect(canInPersona(Role.DUAL, 'rep', 'team_metrics', 'read')).toBe(false);
    });

    test('a REP can never act in an upline persona at all (fail-closed on illegitimate persona)', () => {
      expect(canInPersona(Role.REP, 'upline', 'contacts', 'read')).toBe(false);
    });

    // TEETH: if canInPersona used the DUAL union (can(Role.DUAL,...)) instead of the active persona,
    // the DUAL-acting-as-REP assertion above would flip to true — a bleed.
  });

  describe('DATA isolation — a persona-scoped store never serves the other persona rows', () => {
    test('scope keys for the two personas of one user are distinct', () => {
      expect(personaScopeKey('u1', 'rep')).not.toBe(personaScopeKey('u1', 'upline'));
    });

    test('a rep-context write is invisible to an upline-context read (and vice-versa)', () => {
      const store = new PersonaScopedStore<{ contactName: string }>();
      const userId = 'dual-user-1';

      store.put(userId, 'rep', { contactName: 'rep-warm-market-contact' });
      store.put(userId, 'upline', { contactName: 'downline-member-alex' });

      const repView = store.list(userId, 'rep');
      const uplineView = store.list(userId, 'upline');

      expect(repView).toEqual([{ contactName: 'rep-warm-market-contact' }]);
      expect(uplineView).toEqual([{ contactName: 'downline-member-alex' }]);

      // The bleed assertion: neither persona's view contains the other's row.
      expect(repView.some((r) => r.contactName === 'downline-member-alex')).toBe(false);
      expect(uplineView.some((r) => r.contactName === 'rep-warm-market-contact')).toBe(false);
    });

    test('two different users never share a persona scope', () => {
      const store = new PersonaScopedStore<string>();
      store.put('a', 'rep', 'a-rep');
      store.put('b', 'rep', 'b-rep');
      expect(store.list('a', 'rep')).toEqual(['a-rep']);
      expect(store.list('b', 'rep')).toEqual(['b-rep']);
    });
  });

  describe('§17.2 conflict-of-interest — a DUAL user is never their own upline reviewer', () => {
    test('normal case: a rep-submitted item routes to the submitter’s upline', () => {
      const result = resolveApprovalReviewer({
        submitterUserId: 'rep-1',
        submitterUplineId: 'upline-9',
        nextUplineId: 'rvp-3',
      });
      expect(result).toEqual({ reviewerUserId: 'upline-9', escalated: false });
    });

    test('DUAL self-sponsored: submitter IS their own upline → escalate to next upline', () => {
      const result = resolveApprovalReviewer({
        submitterUserId: 'dual-1',
        submitterUplineId: 'dual-1', // they are their own upline
        nextUplineId: 'rvp-7',
      });
      expect(result.reviewerUserId).toBe('rvp-7');
      expect(result.escalated).toBe(true);
      // The critical property: the reviewer is NEVER the submitter themselves.
      expect(result.reviewerUserId).not.toBe('dual-1');
    });

    test('no eligible upline anywhere → null reviewer (caller falls back per §5.3), never self', () => {
      const result = resolveApprovalReviewer({
        submitterUserId: 'dual-1',
        submitterUplineId: 'dual-1',
        nextUplineId: null,
      });
      expect(result.reviewerUserId).toBeNull();
      expect(result.reviewerUserId).not.toBe('dual-1');
    });
  });
});
