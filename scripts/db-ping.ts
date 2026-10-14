// Quick Supabase connectivity probe: plain SELECT 1 with a hard timeout.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const t0 = Date.now();

const timeout = setTimeout(() => {
  console.error(`DB PING TIMEOUT after ${Date.now() - t0}ms`);
  process.exit(2);
}, 20000);

try {
  const rows = await db.$queryRaw`SELECT 1 AS ok`;
  clearTimeout(timeout);
  console.log(`DB PING OK in ${Date.now() - t0}ms:`, JSON.stringify(rows));
  const users = await db.user.count();
  console.log(`user count: ${users}`);
  process.exit(0);
} catch (err) {
  clearTimeout(timeout);
  console.error("DB PING ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await db.$disconnect();
}
