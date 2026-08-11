// R-18 (admin-mediated password recovery — the SMTP-free recovery path, T-59/W1): POST
// /api/admin/users/[userId]/reset-password — generates a one-time password-reset token for a user
// and returns the RAW token ONLY to the acting admin's session, so the operator can hand it to the
// user out-of-band (chat, phone) until WP05 wires a real email-delivery provider. Session-gated
// via `withCapability('user_profile', 'manage')` — the same ADMIN-only guard every sibling route
// under /api/admin/users/** uses (never a client-forged `x-user-id`); the acting admin's identity
// comes only from the verified session. Writes exactly one hash-chained `AuditEntry` (action
// `user_password_reset_issued`, via `UserManagementService.issueResetToken` -> `AuditService`) and
// one INFO `password_reset` SecurityEvent (R-19's Prisma sink, fail-open by design — a SecurityEvent
// write must never block the recovery decision that triggered it).
//
// The raw token is NEVER echoed into an audit/security row and is never persisted — only its SHA-256
// hash is (src/services/security/password-reset.ts). Expiry is the shared 30-minute constant from
// password-reset.ts. The confirmation path (`POST /api/auth/password-reset/confirm`) consumes this
// token exactly like one issued by the self-service request route — the token is single-use and
// expiring by that path's existing, tested enforcement.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withCapability } from '@/lib/auth/with-role';
import { buildProductionUserManagementService } from '@/services/admin/production';
import { UserManagementNotFoundError } from '@/services/admin/user-management.service';
import { PrismaVerificationTokenStore } from '@/services/security/password-reset';
import { emitSecurityEvent } from '@/services/security/security-event';

export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: { userId: string };
}

export const POST = withCapability('user_profile', 'manage', async (_req, ctx: RouteCtx, session) => {
  const service = buildProductionUserManagementService(prisma);
  try {
    const { rawToken, expiresAt } = await service.issueResetToken(
      session.user.id,
      session.user.role,
      ctx.params.userId,
      new PrismaVerificationTokenStore(prisma)
    );
    await emitSecurityEvent({ userId: ctx.params.userId, type: 'password_reset', severity: 'INFO' });
    return NextResponse.json({ token: rawToken, expiresAt: expiresAt.toISOString() }, { status: 200 });
  } catch (error) {
    if (error instanceof UserManagementNotFoundError) {
      return NextResponse.json({ error: error.message, code: 'NOT_FOUND' }, { status: 404 });
    }
    throw error;
  }
});
