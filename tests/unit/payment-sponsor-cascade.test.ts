// WP10 (T-47) — sponsor-lapse cascade + anniversary (P0) (§15.3 / §18.3; qc-checklist WP10
// checkpoints 4 & 5). PROVE: a lapsed sponsor's member gets a 30-day PROTECTED window (not an
// instant lock) with sponsor/member/RVP notices + convert/re-match; anniversary 60/30/7 notices.

import { SponsorshipState } from '@prisma/client';

import { InMemoryBillingNotificationSink } from '@/services/payment/notifications';
import {
  ANNIVERSARY_NOTICE_DAYS,
  SPONSOR_LAPSE_GRACE_DAYS,
  anniversaryThresholdCrossed,
  computeGraceUntilMs,
  expireElapsedMemberGrace,
  markMemberConverted,
  runAnniversaryNotices,
  runSponsorLapseCascade,
  type AnniversaryApproaching,
  type LapsedSponsorMembership,
  type MemberGraceMembership,
  type MemberTransitionStore,
  type SponsorCascadeStore,
} from '@/services/payment/sponsor-cascade';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 2_000_000_000_000;

function makeStore(overrides: Partial<SponsorCascadeStore> = {}): SponsorCascadeStore & {
  graceMoves: { id: string; until: Date }[];
  ended: string[];
  pendingMarked: string[];
} {
  const graceMoves: { id: string; until: Date }[] = [];
  const ended: string[] = [];
  const pendingMarked: string[] = [];
  return {
    findLapsedSponsorMemberships: async () => [],
    moveMemberToGrace: async (id, until) => {
      graceMoves.push({ id, until });
    },
    findMemberGraceMemberships: async () => [],
    endSponsorship: async (id) => {
      ended.push(id);
    },
    findAnniversaryApproaching: async () => [],
    markAnniversaryPending: async (id) => {
      pendingMarked.push(id);
    },
    graceMoves,
    ended,
    pendingMarked,
    ...overrides,
  };
}

describe('runSponsorLapseCascade (§15.3 — 30-day protection, never an instant lock)', () => {
  const lapsed: LapsedSponsorMembership[] = [
    {
      sponsorshipId: 'sp1',
      memberUserId: 'member1',
      sponsorUserId: 'sponsor1',
      organizationId: 'org1',
      rvpUserId: 'rvp1',
    },
  ];

  test('protects the member (30-day window) and notifies member + sponsor + RVP', async () => {
    const store = makeStore({ findLapsedSponsorMemberships: async () => lapsed });
    const sink = new InMemoryBillingNotificationSink();
    const result = await runSponsorLapseCascade(store, sink, NOW);

    expect(result.membersProtected).toBe(1);
    // 30-day protected window (§15.3).
    expect(store.graceMoves[0].until.getTime()).toBe(NOW + SPONSOR_LAPSE_GRACE_DAYS * DAY);
    expect(computeGraceUntilMs(NOW)).toBe(NOW + 30 * DAY);

    // Exactly the three recipients (§15.3).
    expect(sink.ofType('member_sponsor_lapsed_protected')[0].recipientUserId).toBe('member1');
    expect(sink.ofType('sponsor_payment_failed')[0].recipientUserId).toBe('sponsor1');
    expect(sink.ofType('rvp_sponsor_lapsed')[0].recipientUserId).toBe('rvp1');
    // The member notice promises protection, not a lock.
    expect(sink.ofType('member_sponsor_lapsed_protected')[0].context?.protected_days).toBe(30);
  });

  test('no RVP resolvable → still protects + notifies member and sponsor (RVP notice skipped)', async () => {
    const store = makeStore({
      findLapsedSponsorMemberships: async () => [{ ...lapsed[0], rvpUserId: null }],
    });
    const sink = new InMemoryBillingNotificationSink();
    await runSponsorLapseCascade(store, sink, NOW);
    expect(sink.ofType('rvp_sponsor_lapsed')).toHaveLength(0);
    expect(sink.ofType('member_sponsor_lapsed_protected')).toHaveLength(1);
  });
});

describe('expireElapsedMemberGrace — only AFTER the full protected window', () => {
  test('ends a member still in grace past grace_until; leaves an in-window member untouched', async () => {
    const rows: MemberGraceMembership[] = [
      { sponsorshipId: 'expired1', memberUserId: 'm1', sponsorUserId: 's1', graceUntilMs: NOW - DAY },
      { sponsorshipId: 'stillsafe', memberUserId: 'm2', sponsorUserId: 's1', graceUntilMs: NOW + 5 * DAY },
    ];
    const store = makeStore({ findMemberGraceMemberships: async () => rows });
    const sink = new InMemoryBillingNotificationSink();
    const { ended } = await expireElapsedMemberGrace(store, sink, NOW);
    expect(ended).toBe(1);
    expect(store.ended).toEqual(['expired1']);
    expect(sink.ofType('member_grace_ending')).toHaveLength(1);
  });
});

describe('runAnniversaryNotices (§15.3 — 60/30/7 to both parties)', () => {
  test('fires the threshold notice to member AND sponsor and enters ANNIVERSARY_PENDING', async () => {
    const approaching: AnniversaryApproaching[] = [
      {
        sponsorshipId: 'a1',
        memberUserId: 'm1',
        sponsorUserId: 's1',
        termEndMs: NOW + 25 * DAY,
        daysOut: 30,
        alreadyPending: false,
      },
    ];
    const store = makeStore({ findAnniversaryApproaching: async () => approaching });
    const sink = new InMemoryBillingNotificationSink();
    const { noticed } = await runAnniversaryNotices(store, sink, NOW);
    expect(noticed).toBe(2); // both parties
    expect(store.pendingMarked).toEqual(['a1']);
    expect(sink.ofType('anniversary_30')).toHaveLength(2);
  });

  test('the notice thresholds are exactly 60/30/7', () => {
    expect([...ANNIVERSARY_NOTICE_DAYS]).toEqual([60, 30, 7]);
    expect(anniversaryThresholdCrossed(NOW + 5 * DAY, NOW)).toBe(7);
    expect(anniversaryThresholdCrossed(NOW + 25 * DAY, NOW)).toBe(30);
    expect(anniversaryThresholdCrossed(NOW + 59 * DAY, NOW)).toBe(60);
    expect(anniversaryThresholdCrossed(NOW + 120 * DAY, NOW)).toBeNull();
  });
});

describe('markMemberConverted (self-convert to $297 — §15.3)', () => {
  test('flips the sponsorship to CONVERTED', async () => {
    const marks: string[] = [];
    const store: MemberTransitionStore = {
      findMemberSponsorshipId: async () => 'sp-1',
      markSponsorshipConverted: async (id) => {
        marks.push(id);
      },
    };
    const result = await markMemberConverted(store, 'm1');
    expect(result.converted).toBe(true);
    expect(marks).toEqual(['sp-1']);
  });

  test('no sponsorship → no-op', async () => {
    const store: MemberTransitionStore = {
      findMemberSponsorshipId: async () => null,
      markSponsorshipConverted: jest.fn(),
    };
    const result = await markMemberConverted(store, 'm1');
    expect(result.converted).toBe(false);
    expect(store.markSponsorshipConverted).not.toHaveBeenCalled();
  });

  test('SponsorshipState enum carries the cascade states this logic transitions between', () => {
    // Guard: the schema enum still has the states the cascade depends on.
    expect(SponsorshipState.MEMBER_GRACE).toBe('MEMBER_GRACE');
    expect(SponsorshipState.ANNIVERSARY_PENDING).toBe('ANNIVERSARY_PENDING');
    expect(SponsorshipState.CONVERTED).toBe('CONVERTED');
    expect(SponsorshipState.ENDED).toBe('ENDED');
  });
});
