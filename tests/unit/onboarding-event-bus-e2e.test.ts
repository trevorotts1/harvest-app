// T-58 — event-bus contracts E2E: `user.onboarding_completed`.
//
// This is the ONLY system in the codebase whose own comments literally call it "the event bus"
// (src/types/onboarding.ts:462 "published to shared event bus"; src/services/onboarding/wp01/
// downstream-contracts.ts:1 "§6.9 — Downstream data contracts (event bus)", :79 "The event bus
// (in-memory sink...)"). The DECLARED PAYLOAD SHAPE is `OnboardingCompletedEvent`
// (types/onboarding.ts:462-471): exactly `{ event: 'user.onboarding_completed', user_id, role,
// access_tier, organization, anchor_statement, intensity_setting }` — no more, no less. The PUBLISH
// side is `OnboardingEventSink.publish` / `emitOnboardingCompleted` (downstream-contracts.ts:81-102).
//
// THE REAL REGISTERED SUBSCRIBER: src/services/payment/inngest/payment-inngest-functions.ts's
// `provisionOnOnboardingCompletedFunction`, registered on `{ event: ONBOARDING_COMPLETED_EVENT }`
// (ONBOARDING_COMPLETED_EVENT === 'user.onboarding_completed', same string as the type's literal
// `event` field). Its handler body (lines 62-66) is EXACTLY:
//   const contract = projectToWP10(event.data as unknown as OnboardingCompletedEvent);
//   return provisionFromContract(prisma, contract);
// That file imports the `inngest` package, so — like every other `*-inngest-functions.ts` in this
// repo (see each file's own docstring) — it cannot be imported under Jest's CJS runtime. This suite
// therefore does what the codebase's own established convention does everywhere else (durable-
// queue.ts's `InMemoryDurableQueue.drain()`, its own docstring: "runs each through the same handler
// Inngest would"): it imports the exact same two functions the registered handler calls
// (`projectToWP10`, `provisionFromContract`) and runs them in the exact same sequence against a REAL
// published event object — never a hand-fabricated contract that bypasses the publish step.
//
// grep across the whole src tree for `emitOnboardingCompleted`/`OnboardingEventSink` turns up NO
// production call site outside this event-bus module itself and its own unit test
// (tests/unit/wp01-downstream-contracts.test.ts) — i.e. nothing in the live app actually PUBLISHES
// `user.onboarding_completed` yet (src/app/api/onboarding/complete/route.ts, the only onboarding-
// completion route, writes its own in-memory demo `users`/`sessions` arrays — see ./store.ts — and
// never touches this event bus or a real `User.onboarding_status` column). That is a real
// architecture gap, called out in the build report; it does not change what this suite proves about
// the CONTRACT that does exist end-to-end today (publish -> project -> provision).
//
// Existing unit coverage this suite is ADDITIVE to, not a duplicate of:
//   - tests/unit/wp01-downstream-contracts.test.ts proves the pure shape of `buildOnboardingCompletedEvent`
//     and each `projectToWPxx` derivation from a HAND-BUILT event (never published through the sink).
//   - tests/unit/payment-provisioning.test.ts proves `provisionFromContract` against a HAND-BUILT
//     `WP10PaymentContract` (never derived from a real event via `projectToWP10`).
// Neither closes the loop the REAL subscriber actually runs: publish -> projectToWP10 -> provisionFromContract.
// This suite closes that loop, and adds the boundary/ordering/idempotency/multi-consumer invariants
// the T-58 brief calls for.

import { AccessTier, OnboardingStatus, Role, IntensitySetting } from '@prisma/client';

import {
  InMemoryOnboardingEventSink,
  emitOnboardingCompleted,
  projectToWP02,
  projectToWP03,
  projectToWP04,
  projectToWP05,
  projectToWP06,
  projectToWP07,
  projectToWP08,
  projectToWP09,
  projectToWP10,
  type OnboardingCompletedInput,
} from '@/services/onboarding/wp01/downstream-contracts';
import {
  ProvisioningNotAllowedError,
  provisionFromContract,
  type ProvisioningPrismaClient,
  type ProvisionedSubscription,
} from '@/services/payment/provisioning';

// ONBOARDING_COMPLETED_EVENT is defined in payment-inngest-functions.ts (which imports `inngest` and
// is unreachable here) as the literal string 'user.onboarding_completed' — the SAME literal the
// `OnboardingCompletedEvent.event` field is typed to. Asserted directly below rather than imported,
// exactly once, so a drift between the two literals would be caught by the type system at the
// import site elsewhere and by this string-equality check here.
const ONBOARDING_COMPLETED_EVENT = 'user.onboarding_completed';

const BASE_INPUT: OnboardingCompletedInput = {
  user_id: 'user-1',
  role: Role.REP,
  access_tier: AccessTier.FREE_ORG_LINKED,
  organization: ['org-1'],
  anchor_statement: 'I build so my children never have to wonder.',
  intensity_setting: IntensitySetting.MEDIUM,
};

/** A STATEFUL fake Prisma (Map-backed), matching the repo's action-queue-boundary.test.ts /
 *  payment-provisioning.test.ts convention — but stateful (not canned-return-value) so a first
 *  `provisionFromContract` call's `subscription.create` is genuinely visible to a SECOND call's
 *  `subscription.findFirst`, proving idempotency across REAL state, not a pre-scripted mock. */
function createFakeProvisioningPrisma(users: Record<string, OnboardingStatus>) {
  const subscriptions = new Map<string, ProvisionedSubscription>(); // keyed by user_id
  const sponsorships = new Map<string, string>(); // member_user_id -> sponsor_user_id
  let seq = 0;

  const prisma: ProvisioningPrismaClient = {
    user: {
      findUnique: async ({ where }) => {
        const status = users[where.id];
        return status === undefined ? null : { onboarding_status: status };
      },
    },
    subscription: {
      findFirst: async ({ where }) => {
        const sub = subscriptions.get(where.user_id);
        return sub && sub.status === where.status ? sub : null;
      },
      create: async ({ data }) => {
        seq += 1;
        const created: ProvisionedSubscription = {
          id: `sub-${seq}`,
          user_id: data.user_id,
          plan_tier: data.plan_tier,
          status: data.status,
          org_sponsored: data.org_sponsored,
          sponsor_user_id: data.sponsor_user_id,
        };
        subscriptions.set(data.user_id, created);
        return created;
      },
    },
    sponsorship: {
      findFirst: async ({ where }) => {
        const sponsorUserId = sponsorships.get(where.member_user_id);
        return sponsorUserId ? { sponsor_user_id: sponsorUserId } : null;
      },
    },
  };

  return { prisma, subscriptions, sponsorships };
}

/** Runs the EXACT sequence `provisionOnOnboardingCompletedFunction`'s handler body runs
 *  (payment-inngest-functions.ts:62-66) against a REAL, already-published event instance. */
function runRealSubscriberChain(prisma: ProvisioningPrismaClient, publishedEventData: unknown) {
  const contract = projectToWP10(publishedEventData as Parameters<typeof projectToWP10>[0]);
  return provisionFromContract(prisma, contract);
}

describe('event-bus contract — user.onboarding_completed -> WP10 provisioning (T-58)', () => {
  test('the event type literal matches the Inngest trigger string the real subscriber is registered on', () => {
    const sink = new InMemoryOnboardingEventSink();
    return emitOnboardingCompleted(sink, BASE_INPUT).then((event) => {
      expect(event.event).toBe(ONBOARDING_COMPLETED_EVENT);
    });
  });

  // (1) DELIVERY — publish through the real sink, run the real subscriber-handler chain on the
  // ACTUAL published instance (sink.events[0]), never a separately-built contract.
  describe('(1) delivery — publish -> projectToWP10 -> provisionFromContract, on the published instance', () => {
    test('a GATED_COMPLETE, unprovisioned user is provisioned per the published access_tier', async () => {
      const sink = new InMemoryOnboardingEventSink();
      await emitOnboardingCompleted(sink, { ...BASE_INPUT, access_tier: AccessTier.PAID_INDIVIDUAL });
      expect(sink.events).toHaveLength(1);

      const { prisma } = createFakeProvisioningPrisma({ 'user-1': OnboardingStatus.GATED_COMPLETE });
      const result = await runRealSubscriberChain(prisma, sink.events[0]);

      expect(result.provisioned).toBe(true);
      expect(result.subscription.user_id).toBe('user-1');
      expect(result.subscription.plan_tier).toBe('individual');
      expect(result.subscription.org_sponsored).toBe(false);
    });

    test('a sponsored (org-linked) published event provisions free, no card, sponsor linked from the live Sponsorship row', async () => {
      const sink = new InMemoryOnboardingEventSink();
      await emitOnboardingCompleted(sink, { ...BASE_INPUT, access_tier: AccessTier.FREE_ORG_LINKED });

      const { prisma, sponsorships } = createFakeProvisioningPrisma({ 'user-1': OnboardingStatus.GATED_COMPLETE });
      sponsorships.set('user-1', 'sponsor-42');
      const result = await runRealSubscriberChain(prisma, sink.events[0]);

      expect(result.provisioned).toBe(true);
      expect(result.subscription.org_sponsored).toBe(true);
      expect(result.subscription.sponsor_user_id).toBe('sponsor-42');
    });
  });

  // (2) PAYLOAD SHAPE AT THE BOUNDARY — the published event carries EXACTLY the declared fields,
  // and the subscriber's projection never leaks an undeclared/phantom field through to provisioning.
  describe('(2) payload shape at the boundary', () => {
    test('the published event has exactly the 7 §6.9 fields — no more, no less', async () => {
      const sink = new InMemoryOnboardingEventSink();
      await emitOnboardingCompleted(sink, BASE_INPUT);
      expect(Object.keys(sink.events[0]).sort()).toEqual(
        ['access_tier', 'anchor_statement', 'event', 'intensity_setting', 'organization', 'role', 'user_id'].sort()
      );
    });

    // TEETH: a subscriber that (incorrectly) read a phantom field instead of the declared
    // `access_tier` would provision the WRONG plan; this proves it can't, because
    // `WP10PaymentContract` is the FULL surface `provisionFromContract` ever sees.
    test('a phantom field riding the wire (e.g. a forged legacy tier string) never reaches provisioning', async () => {
      const sink = new InMemoryOnboardingEventSink();
      await emitOnboardingCompleted(sink, { ...BASE_INPUT, access_tier: AccessTier.FREE_ORG_LINKED });
      const forged = { ...sink.events[0], legacy_tier_override: 'ENTERPRISE' } as unknown;

      const contract = projectToWP10(forged as Parameters<typeof projectToWP10>[0]);
      expect(Object.keys(contract).sort()).toEqual(['access_tier', 'user_id']);
      expect(contract.access_tier).toBe(AccessTier.FREE_ORG_LINKED); // NOT the forged 'ENTERPRISE'

      const { prisma } = createFakeProvisioningPrisma({ 'user-1': OnboardingStatus.GATED_COMPLETE });
      const result = await provisionFromContract(prisma, contract);
      expect(result.subscription.plan_tier).not.toBe('enterprise');
    });
  });

  // (3) ORDERING-INDEPENDENCE / FAIL-CLOSED PRECONDITION — provisioning.ts's own doc comment
  // ("provisionFromContract independently enforces the 'only after onboarding_completed'
  // precondition ... so provisioning can never run early even if the event fires out of order").
  // This is the ONE ordering guarantee the code actually makes (no general FIFO/ordering guarantee
  // is claimed anywhere else) — asserted here, not invented.
  describe('(3) ordering-independence — the guarantee provisioning.ts documents, and only that one', () => {
    test('the event fires (is published/delivered) BEFORE the DB reflects GATED_COMPLETE -> REFUSED, nothing created', async () => {
      const sink = new InMemoryOnboardingEventSink();
      await emitOnboardingCompleted(sink, BASE_INPUT);

      // The live row still shows IN_PROGRESS — the event arrived "out of order" relative to the DB.
      const { prisma, subscriptions } = createFakeProvisioningPrisma({ 'user-1': OnboardingStatus.IN_PROGRESS });
      await expect(runRealSubscriberChain(prisma, sink.events[0])).rejects.toBeInstanceOf(ProvisioningNotAllowedError);
      expect(subscriptions.size).toBe(0);
    });

    test('a replay for a user who no longer exists (never onboarded) is refused, fail-closed', async () => {
      const sink = new InMemoryOnboardingEventSink();
      await emitOnboardingCompleted(sink, { ...BASE_INPUT, user_id: 'ghost-user' });
      const { prisma } = createFakeProvisioningPrisma({}); // no row for 'ghost-user'
      await expect(runRealSubscriberChain(prisma, sink.events[0])).rejects.toBeInstanceOf(ProvisioningNotAllowedError);
    });
  });

  // (4) IDEMPOTENCY — the ONE guarantee provisionFromContract's own doc comment makes ("a user may
  // have at most one ACTIVE subscription ... this returns it unchanged (provisioned: false) — so
  // replaying the onboarding-completed event ... never double-provisions"). Proved here across a
  // REAL stateful fake (the first call's `create` is what the second call's `findFirst` sees) —
  // not a pre-seeded canned mock — so a bug in either projection or provisioning would surface.
  describe('(4) idempotent replay — same published event run through the real chain twice', () => {
    test('replaying the identical event a second time does not double-provision', async () => {
      const sink = new InMemoryOnboardingEventSink();
      await emitOnboardingCompleted(sink, { ...BASE_INPUT, access_tier: AccessTier.PAID_INDIVIDUAL });
      const { prisma, subscriptions } = createFakeProvisioningPrisma({ 'user-1': OnboardingStatus.GATED_COMPLETE });

      const first = await runRealSubscriberChain(prisma, sink.events[0]);
      const second = await runRealSubscriberChain(prisma, sink.events[0]); // Inngest replay/retry of the SAME event

      expect(first.provisioned).toBe(true);
      expect(second.provisioned).toBe(false);
      expect(second.subscription.id).toBe(first.subscription.id); // same row, not a duplicate
      expect(subscriptions.size).toBe(1);
    });
  });

  // (5) MULTI-CONSUMER FAN-OUT — §6.9 declares NINE downstream consumers (WP02-WP10) of this ONE
  // published event. Only WP10 has real automatic Inngest subscriber wiring today (see this file's
  // header comment) — the other eight are consumed synchronously by their own services / are as-yet
  // unwired (a gap called out in the build report, not fabricated as "tested" here). What IS true
  // and testable: every one of the nine declared projections derives correctly from the SAME
  // actually-published event instance (sink.events[0]), never a second, independently-assembled copy.
  describe('(5) multi-consumer fan-out — all nine §6.9 projections read the ONE published instance', () => {
    test('WP02-WP10 each derive their declared fields from sink.events[0], not a re-built event', async () => {
      const sink = new InMemoryOnboardingEventSink();
      await emitOnboardingCompleted(sink, BASE_INPUT);
      const published = sink.events[0];

      expect(projectToWP02(published, { sponsor_id: 'sponsor-1', onboarding_status: OnboardingStatus.GATED_COMPLETE })).toEqual({
        user_id: 'user-1', role: Role.REP, organization: ['org-1'], onboarding_status: OnboardingStatus.GATED_COMPLETE, sponsor_id: 'sponsor-1',
      });
      expect(projectToWP03(published, { onboarding_status: OnboardingStatus.GATED_COMPLETE, solution_number: '1234567' }).solution_number).toBe('1234567');
      expect(projectToWP04(published)).toEqual({ user_id: 'user-1', anchor_statement: BASE_INPUT.anchor_statement, intensity_setting: IntensitySetting.MEDIUM, role: Role.REP });
      expect(projectToWP05(published, { first_name: 'Tasha', mobile_phone: '+15551234567' }).mobile_phone).toBe('+15551234567');
      expect(projectToWP06(published)).toEqual({ user_id: 'user-1', anchor_statement: BASE_INPUT.anchor_statement, organization: ['org-1'] });
      expect(projectToWP07(published)).toEqual({ user_id: 'user-1', anchor_statement: BASE_INPUT.anchor_statement, intensity_setting: IntensitySetting.MEDIUM });
      expect(projectToWP08(published, { sponsor_id: 'sponsor-1' })).toEqual({ user_id: 'user-1', sponsor_id: 'sponsor-1', access_tier: AccessTier.FREE_ORG_LINKED, role: Role.REP });
      expect(projectToWP09(published, { calendar_preferences: { timezone: 'America/New_York', connected: true }, calendar_connected: true }).calendar_connected).toBe(true);
      expect(projectToWP10(published)).toEqual({ user_id: 'user-1', access_tier: AccessTier.FREE_ORG_LINKED });

      // Same object identity proof: every projection call above shared the ONE `published` reference
      // (not nine separately reconstructed events) — sink still holds exactly that one event.
      expect(sink.events).toHaveLength(1);
      expect(sink.events[0]).toBe(published);
    });
  });
});
