import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
    // WAN database (Supabase): raise interactive-transaction limits above the
    // 5s default so multi-step service transactions survive network latency.
    transactionOptions: {
      maxWait: 20_000,
      timeout: 120_000,
    },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
