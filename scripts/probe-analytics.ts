/**
 * Probe: validate the NEW analytics SQL added to getDashboard (Postgres).
 * Run with env sourced: set -a && source .env && set +a && bun scripts/probe-analytics.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const bid = (await db.business.findFirst({ select: { id: true } }))?.id;
  if (!bid) throw new Error("no business");
  const from = new Date(Date.now() - 29 * 864e5);

  const trend = await db.$queryRaw<{ day: string; dept: string; revenue: number; gp: number; qty: number }[]>`
    SELECT to_char(date_trunc('day', s."createdAt"), 'YYYY-MM-DD') AS day,
           si."department" AS dept,
           SUM(si."lineTotal")::float8 AS revenue,
           SUM(si."lineTotal" - si."taxAmount" - (si."costPrice" * si."quantityBase"))::float8 AS gp,
           SUM(si."quantityBase")::float8 AS qty
    FROM "SaleItem" si
    JOIN "Sale" s ON s.id = si."saleId"
    WHERE s."businessId" = ${bid} AND s."status" = 'COMPLETED' AND s."createdAt" >= ${from}
    GROUP BY 1, 2 ORDER BY 1`;
  console.log("TREND rows:", trend.length, "| sample:", JSON.stringify(trend.slice(0, 2)));

  const invDept = await db.$queryRaw<{ dept: string; value: number }[]>`
    SELECT p."department" AS dept, SUM(sb."quantity" * p."costPrice")::float8 AS value
    FROM "StockBalance" sb JOIN "Product" p ON p.id = sb."productId"
    WHERE sb."businessId" = ${bid} AND sb."quantity" > 0 GROUP BY 1`;
  console.log("INV_DEPT:", JSON.stringify(invDept));

  const invCat = await db.$queryRaw<{ name: string; value: number }[]>`
    SELECT COALESCE(c."name", 'Uncategorised') AS name, SUM(sb."quantity" * p."costPrice")::float8 AS value
    FROM "StockBalance" sb JOIN "Product" p ON p.id = sb."productId"
    LEFT JOIN "Category" c ON c.id = p."categoryId"
    WHERE sb."businessId" = ${bid} AND sb."quantity" > 0
    GROUP BY 1 ORDER BY 2 DESC LIMIT 8`;
  console.log("INV_CAT:", JSON.stringify(invCat));

  const expiry = await db.$queryRaw<{ bucket: string; value: number; batches: number }[]>`
    SELECT CASE
             WHEN "expiryDate" <= now() THEN 'expired'
             WHEN "expiryDate" <= now() + interval '30 days' THEN 'd30'
             ELSE 'd90' END AS bucket,
           SUM("quantityRemaining" * "unitCost")::float8 AS value, COUNT(*)::int AS batches
    FROM "PharmacyBatch"
    WHERE "businessId" = ${bid} AND "quantityRemaining" > 0
      AND "status" IN ('ACTIVE', 'EXPIRED') AND "expiryDate" <= now() + interval '90 days'
    GROUP BY 1`;
  console.log("EXPIRY:", JSON.stringify(expiry));

  const restock = await db.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM "Product" p
    JOIN "StockBalance" sb ON sb."productId" = p.id
    WHERE p."businessId" = ${bid} AND p."isActive" = true AND sb."quantity" <= p."reorderLevel"`;
  console.log("RESTOCK:", restock[0]?.count);
}

main().finally(() => db.$disconnect());
