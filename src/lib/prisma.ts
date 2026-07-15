import { PrismaClient } from '@prisma/client';

// Standard Next.js singleton pattern: in dev, `next dev` hot-reloads modules on every save, which
// would otherwise construct a fresh PrismaClient (and a fresh connection pool) per reload. Stashing
// the instance on `globalThis` survives the reload. Existing services in this repo (e.g.
// src/services/warm-market/contact.service.ts) construct their own `new PrismaClient()` per
// instance; this singleton is introduced for the auth layer (T-04), where NextAuth's PrismaAdapter
// needs one shared, long-lived client, and is safe for any other module to import going forward.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
