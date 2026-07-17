import bcrypt from 'bcryptjs';
import { OrgType } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { getBreachedPasswordChecker } from '@/services/security/credential-stuffing';
// T-19 QC minor fix (§6.7): see the `access_tier` comment on `prisma.user.create` below —
// this route used to rely on the schema's bare `@default(FREE_ORG_LINKED)`, which mislabeled every
// unsponsored EXTERNAL registrant. `assignAccessTierFromSignals` is the single §6.7 decision
// function (already the live tier source for `/api/onboarding/complete`); reusing it here keeps
// there being exactly one place a tier is ever decided.
import { assignAccessTierFromSignals } from '@/services/onboarding/wp01/access-tier';

const BCRYPT_ROUNDS = 12;

/**
 * User registration (T-04). Auth.js/NextAuth's CredentialsProvider (src/lib/auth/options.ts) is
 * verify-only by design — it has no registration flow of its own — so this stays a plain,
 * Prisma-backed endpoint. It now writes a real `User` row (with a real bcrypt hash) in place of
 * the pre-T-04 demo stub's in-memory array and plaintext `password_hash = password` placeholder.
 * A successful registration does not itself start a session; the client is expected to call
 * NextAuth's `signIn('credentials', ...)` afterward (see src/app/auth/page.tsx).
 *
 * Scope note: full onboarding business rules — solution-number format validation, the Seven Whys
 * gate, sponsor matching, access-tier assignment (§6.5–§6.7) — belong to the WP01 onboarding unit,
 * not this auth unit. This route preserves the pre-existing behavior it inherited: it creates the
 * identity row and gates on solution-number *presence* for Primerica orgs, nothing more.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name, phone, orgType, solutionNumber, organizationId } = body;

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'email, password, and name are required' },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    // §18.10 "set/reset screens screen against known-breached passwords" — registration is the
    // "set" screen this bullet names (password-reset's confirm step is the "reset" screen; see
    // src/app/api/auth/password-reset/confirm/route.ts).
    const isBreached = await getBreachedPasswordChecker().isBreached(password);
    if (isBreached) {
      return NextResponse.json(
        { error: 'That password appears in known data breaches. Please choose a different one.' },
        { status: 400 }
      );
    }

    const resolvedOrgType: OrgType = orgType === 'PRIMERICA' ? OrgType.PRIMERICA : OrgType.EXTERNAL;

    // Primerica org gate (§6.3): solution number is required, user-declared, and — per spec —
    // explicitly never verified against an external system.
    if (resolvedOrgType === OrgType.PRIMERICA && !solutionNumber) {
      return NextResponse.json(
        { error: 'Solution number is required for Primerica representatives' },
        { status: 400 }
      );
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // T-19 QC minor fix (§6.7): this used to rely on the schema's bare `@default(FREE_ORG_LINKED)`
    // for EVERY registrant, including an unsponsored EXTERNAL rep — §6.7 says "email/password no
    // sponsor -> free_paid_external". No pricing harm either way (both tiers are $0 at
    // registration, see `ACCESS_TIER_PRICE_CENTS`), but the label was wrong. This route accepts no
    // sponsor-invite token of its own (that's the WP01 sponsor-matching/invite flow — §6.5/§6.6,
    // T-19's `/api/onboarding/complete` route), so `sponsorLinked` here is approximated the same
    // way `OnboardingService.determineAccessTier`/`seedAccessTier` already do: a Primerica org
    // context implies the rep onboards under their existing upline/org; an EXTERNAL registrant with
    // no sponsor-invite field on this endpoint is the "no sponsor" §6.7 path.
    const accessTier = assignAccessTierFromSignals({
      authMethod: 'email_password',
      sponsorLinked: resolvedOrgType === OrgType.PRIMERICA,
    });

    const user = await prisma.user.create({
      data: {
        email,
        password_hash,
        name,
        phone: phone || null,
        org_type: resolvedOrgType,
        solution_number: resolvedOrgType === OrgType.PRIMERICA ? solutionNumber : null,
        organization_id: organizationId || null,
        access_tier: accessTier,
        // `role` defaults to REP at the schema level; admin-provisioned/post-subscription-upgrade
        // tier transitions (the other two §6.7 paths) are WP01/WP10 territory and are not decided
        // here.
      },
    });

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          org_type: user.org_type,
          access_tier: user.access_tier,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
