/**
 * Probe: do the dashboard/reports raw SQL queries work on Postgres?
 * Run: bun scripts/probe-raw-sql.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const bid = (await db.business.findFirst({ select: { id: true } }))?.id;
  if (!bid) throw new Error("no business");

  // 1. Current SQLite-dialect query (expected to FAIL on Postgres)
  try {
    await db.$queryRaw`SELECT date(createdAt / 1000, 'unixepoch') as day, CAST(SUM(total) AS REAL) as total
      FROM Sale WHERE businessId = ${bid} AND status = 'COMPLETED'
      GROUP BY date(createdAt) ORDER BY day ASC LIMIT 3`;
    console.log("SQLITE_DIALECT: OK (unexpected)");
  } catch (e) {
    console.log("SQLITE_DIALECT: FAIL ->", (e as Error).message.slice(0, 160));
  }

  // 2. Postgres-native alternative
  try {
    const rows = await db.$queryRaw<{ day: string; total: number }[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as day, SUM("total")::float8 as total
      FROM "Sale" WHERE "businessId" = ${bid} AND "status" = 'COMPLETED'
      GROUP BY 1 ORDER BY 1 ASC LIMIT 3`;
    console.log("PG_DIALECT: OK ->", JSON.stringify(rows));
  } catch (e) {
    console.log("PG_DIALECT: FAIL ->", (e as Error).message.slice(0, 160));
  }

  // 3. Does getDashboard() itself work end-to-end?
  try {
    const mod = await import("../src/server/queries/dashboard");
    const d = await mod.getDashboard(bid);
    console.log("GET_DASHBOARD: OK ->", "sparkline points:", (d as { sparkline: unknown[] }).sparkline.length);
  } catch (e) {
    console.log("GET_DASHBOARD: FAIL ->", (e as Error).message.slice(0, 200));
  }
}

main().finally(() => db.$disconnect());
