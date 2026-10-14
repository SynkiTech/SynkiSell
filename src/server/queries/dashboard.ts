"use server";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dec, money, toPlain } from "@/lib/money";
import { expireMarkBatches } from "@/server/inventory/stock-service";
import { requirePermission } from "@/lib/guards";

const D = Prisma.Decimal;

function startOfDay(offsetDays = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - offsetDays * 864e5);
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

export async function getDashboard(businessId: string) {
  const ctx = await requirePermission(businessId, "dashboard.view");
  const bid = ctx.businessId;

  await db.$transaction(async (tx) => expireMarkBatches(tx, bid));

  const now = new Date();
  const todayStart = startOfDay(0);
  const yesterdayStart = startOfDay(1);
  const weekStart = startOfDay(6);

  const saleWhere = (from: Date, to: Date) => ({ businessId: bid, createdAt: { gte: from, lte: to }, status: "COMPLETED" as const });

  const [todayAgg, yesterdayAgg, weekAgg, prevWeekAgg, deptToday, paymentsToday, lowStock, expiringBatches, recentSales, openShifts, supplierBalanceAgg, recentExpenses, recentVoids, subscription] = await Promise.all([
    db.sale.aggregate({ where: saleWhere(todayStart, now), _sum: { total: true, discountTotal: true }, _count: true }),
    db.sale.aggregate({ where: saleWhere(yesterdayStart, todayStart), _sum: { total: true }, _count: true }),
    db.sale.aggregate({ where: saleWhere(weekStart, now), _sum: { total: true }, _count: true }),
    db.sale.aggregate({ where: saleWhere(new Date(weekStart.getTime() - 7 * 864e5), weekStart), _sum: { total: true }, _count: true }),
    db.saleItem.groupBy({
      by: ["department"],
      where: { businessId: bid, sale: { createdAt: { gte: todayStart }, status: "COMPLETED" } },
      _sum: { lineTotal: true, quantity: true },
    }),
    db.salePayment.findMany({
      where: { sale: { businessId: bid, createdAt: { gte: todayStart }, status: { not: "VOIDED" } } },
      select: { method: true, amount: true },
    }),
    db.product.findMany({
      where: { businessId: bid, isActive: true, stockBalance: { quantity: { lte: 0 } } },
      select: { id: true, name: true, baseUnit: true, reorderLevel: true, stockBalance: { select: { quantity: true } }, department: true },
      take: 12,
      orderBy: { name: "asc" },
    }),
    db.pharmacyBatch.findMany({
      where: { businessId: bid, status: "ACTIVE", expiryDate: { lte: new Date(Date.now() + 90 * 864e5) }, quantityRemaining: { gt: 0 } },
      include: { product: { select: { name: true, sku: true, baseUnit: true } } },
      orderBy: { expiryDate: "asc" },
      take: 12,
    }),
    db.sale.findMany({
      where: { businessId: bid },
      include: { cashier: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    db.cashierShift.findMany({
      where: { businessId: bid, status: "OPEN" },
      include: { user: { select: { name: true } } },
      take: 5,
    }),
    db.supplier.aggregate({ where: { businessId: bid, isActive: true }, _sum: { balance: true } }),
    db.expense.findMany({
      where: { businessId: bid, status: "APPROVED", date: { gte: startOfDay(6) } },
      include: { category: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 6,
    }),
    db.sale.findMany({
      where: { businessId: bid, OR: [{ status: "VOIDED" }, { status: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] } }] },
      include: { cashier: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    db.subscription.findUnique({ where: { businessId: bid }, include: { plan: { select: { name: true } } } }),
  ]);

  // Gross profit today: (lineTotal excl. tax) − (COGS). Explicitly labelled
  // ESTIMATED GROSS — not net (operating expenses excluded).
  const todayItems = await db.saleItem.findMany({
    where: { businessId: bid, sale: { createdAt: { gte: todayStart, lte: now }, status: "COMPLETED" } },
    select: { lineTotal: true, taxAmount: true, costPrice: true, quantityBase: true, department: true },
  });
  const grossProfitToday = todayItems.reduce((acc, i) => acc.add(dec(i.lineTotal).minus(dec(i.taxAmount)).minus(dec(i.costPrice).mul(dec(i.quantityBase)))), new D(0));
  const cogsToday = todayItems.reduce((acc, i) => acc.add(dec(i.costPrice).mul(dec(i.quantityBase))), new D(0));

  const weekItems = await db.saleItem.findMany({
    where: { businessId: bid, sale: { createdAt: { gte: weekStart, lte: now }, status: "COMPLETED" } },
    select: { lineTotal: true, taxAmount: true, costPrice: true, quantityBase: true },
  });
  const grossProfitWeek = weekItems.reduce((acc, i) => acc.add(dec(i.lineTotal).minus(dec(i.taxAmount)).minus(dec(i.costPrice).mul(dec(i.quantityBase)))), new D(0));

  // Payment mix today
  const paymentMix: Record<string, Prisma.Decimal> = {};
  for (const p of paymentsToday) {
    paymentMix[p.method] = (paymentMix[p.method] ?? new D(0)).add(dec(p.amount));
  }

  // ─────────────────────────────────────────────────────────────────────
  // Analytics series (PostgreSQL-native — date_trunc, NOT SQLite dialect).
  // All figures below are real, permission-filtered business records.
  // ─────────────────────────────────────────────────────────────────────
  const trendFrom = startOfDay(29);

  const [trendRows, inventoryByDeptRows, inventoryByCategoryRows, expiryRows, restockRow] = await Promise.all([
    // 30-day daily revenue / gross profit / units per department
    db.$queryRaw<{ day: string; dept: string; revenue: number; gp: number; qty: number }[]>`
      SELECT to_char(date_trunc('day', s."createdAt"), 'YYYY-MM-DD') AS day,
             si."department" AS dept,
             SUM(si."lineTotal")::float8 AS revenue,
             SUM(si."lineTotal" - si."taxAmount" - (si."costPrice" * si."quantityBase"))::float8 AS gp,
             SUM(si."quantityBase")::float8 AS qty
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      WHERE s."businessId" = ${bid} AND s."status" = 'COMPLETED' AND s."createdAt" >= ${trendFrom}
      GROUP BY 1, 2
      ORDER BY 1`,
    // Inventory value at cost by department
    db.$queryRaw<{ dept: string; value: number }[]>`
      SELECT p."department" AS dept, SUM(sb."quantity" * p."costPrice")::float8 AS value
      FROM "StockBalance" sb
      JOIN "Product" p ON p.id = sb."productId"
      WHERE sb."businessId" = ${bid} AND sb."quantity" > 0
      GROUP BY 1`,
    // Inventory value at cost by category (top 8)
    db.$queryRaw<{ name: string; value: number }[]>`
      SELECT COALESCE(c."name", 'Uncategorised') AS name, SUM(sb."quantity" * p."costPrice")::float8 AS value
      FROM "StockBalance" sb
      JOIN "Product" p ON p.id = sb."productId"
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE sb."businessId" = ${bid} AND sb."quantity" > 0
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 8`,
    // Expiry risk buckets (value at cost) — expired / <=30d / 31-90d
    db.$queryRaw<{ bucket: string; value: number; batches: number }[]>`
      SELECT CASE
               WHEN "expiryDate" <= now() THEN 'expired'
               WHEN "expiryDate" <= now() + interval '30 days' THEN 'd30'
               ELSE 'd90'
             END AS bucket,
             SUM("quantityRemaining" * "unitCost")::float8 AS value,
             COUNT(*)::int AS batches
      FROM "PharmacyBatch"
      WHERE "businessId" = ${bid} AND "quantityRemaining" > 0
        AND "status" IN ('ACTIVE', 'EXPIRED')
        AND "expiryDate" <= now() + interval '90 days'
      GROUP BY 1`,
    // Products at/below reorder level
    db.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "Product" p
      JOIN "StockBalance" sb ON sb."productId" = p.id
      WHERE p."businessId" = ${bid} AND p."isActive" = true AND sb."quantity" <= p."reorderLevel"`,
  ]);

  // Fill a continuous 30-day series (0 for days without sales — honest gaps)
  const trend: { day: string; label: string; pharmacy: number; supermarket: number; revenue: number; grossProfit: number; units: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = startOfDay(i).toISOString().slice(0, 10);
    const rows = trendRows.filter((r) => r.day === day);
    const pharm = rows.find((r) => r.dept === "PHARMACY");
    const market = rows.find((r) => r.dept === "SUPERMARKET");
    trend.push({
      day,
      label: day.slice(5),
      pharmacy: pharm ? Number(pharm.revenue) : 0,
      supermarket: market ? Number(market.revenue) : 0,
      revenue: rows.reduce((a, r) => a + Number(r.revenue), 0),
      grossProfit: rows.reduce((a, r) => a + Number(r.gp), 0),
      units: rows.reduce((a, r) => a + Number(r.qty), 0),
    });
  }

  // Department comparison over the full 30-day window
  const dept30 = new Map<string, { revenue: number; grossProfit: number; units: number }>();
  for (const r of trendRows) {
    const cur = dept30.get(r.dept) ?? { revenue: 0, grossProfit: 0, units: 0 };
    cur.revenue += Number(r.revenue);
    cur.grossProfit += Number(r.gp);
    cur.units += Number(r.qty);
    dept30.set(r.dept, cur);
  }
  const departmentComparison = [...dept30.entries()].map(([department, v]) => ({
    department,
    revenue: v.revenue,
    grossProfit: v.grossProfit,
    units: v.units,
    marginPct: v.revenue > 0 ? Math.round((v.grossProfit / v.revenue) * 1000) / 10 : null,
  }));

  const expiryRisk = {
    expired: expiryRows.find((r) => r.bucket === "expired") ?? { value: 0, batches: 0 },
    within30: expiryRows.find((r) => r.bucket === "d30") ?? { value: 0, batches: 0 },
    within90: expiryRows.find((r) => r.bucket === "d90") ?? { value: 0, batches: 0 },
  };
  const inventoryTotalValue = inventoryByDeptRows.reduce((a, r) => a + Number(r.value), 0);

  const growth = yesterdayAgg._sum.total && dec(yesterdayAgg._sum.total).gt(0)
    ? dec(todayAgg._sum.total ?? 0).minus(dec(yesterdayAgg._sum.total)).div(dec(yesterdayAgg._sum.total)).mul(100)
    : null;

  return toPlain({
    generatedAt: now.toISOString(),
    today: {
      sales: money(todayAgg._sum.total ?? 0),
      count: todayAgg._count,
      grossProfit: money(grossProfitToday),
      cogs: money(cogsToday),
      discount: money(todayAgg._sum.discountTotal ?? 0),
    },
    yesterday: { sales: money(yesterdayAgg._sum.total ?? 0), count: yesterdayAgg._count },
    growthPct: growth?.toDecimalPlaces(1) ?? null,
    week: {
      sales: money(weekAgg._sum.total ?? 0),
      count: weekAgg._count,
      grossProfit: money(grossProfitWeek),
      prevSales: money(prevWeekAgg._sum.total ?? 0),
    },
    departments: deptToday.map((d) => ({ department: d.department, total: money(d._sum.lineTotal ?? 0), qty: d._sum.quantity ?? dec(0) })),
    paymentMix: Object.fromEntries(Object.entries(paymentMix).map(([k, v]) => [k, money(v)])),
    lowStock,
    expiringBatches: expiringBatches.map((b) => ({
      id: b.id,
      productName: b.product.name,
      batchNumber: b.batchNumber,
      expiryDate: b.expiryDate.toISOString(),
      quantityRemaining: b.quantityRemaining,
      baseUnit: b.product.baseUnit,
      valueAtCost: money(dec(b.quantityRemaining).mul(b.unitCost)),
      daysLeft: Math.ceil((b.expiryDate.getTime() - now.getTime()) / 864e5),
    })),
    expiringValue: money(expiringBatches.reduce((acc, b) => acc.add(dec(b.quantityRemaining).mul(b.unitCost)), new D(0))),
    recentSales: recentSales.map((s) => ({ id: s.id, number: s.number, total: s.total, status: s.status, cashier: s.cashier.name, createdAt: s.createdAt.toISOString() })),
    recentVoids: recentVoids.map((s) => ({ id: s.id, number: s.number, status: s.status, cashier: s.cashier.name, updatedAt: s.updatedAt.toISOString() })),
    openShifts: openShifts.map((s) => ({ id: s.id, cashier: s.user.name, openedAt: s.openedAt.toISOString() })),
    supplierBalance: money(supplierBalanceAgg._sum.balance ?? 0),
    recentExpenses: recentExpenses.map((e) => ({ id: e.id, description: e.description, amount: e.amount, category: e.category?.name ?? "—", date: e.date.toISOString() })),
    subscription: subscription
      ? { status: subscription.status, plan: subscription.plan.name, endDate: subscription.endDate?.toISOString() ?? null }
      : null,
    sparkline: trend.map((t) => ({ day: t.day, total: t.revenue })).slice(-14),
    // Analytics for the chart system (real, permission-filtered data)
    trend,
    departmentComparison,
    inventory: {
      totalValue: inventoryTotalValue,
      valueByDept: inventoryByDeptRows.map((r) => ({ name: r.dept === "PHARMACY" ? "Pharmacy" : r.dept === "SUPERMARKET" ? "Supermarket" : "Shared", value: Number(r.value) })),
      valueByCategory: inventoryByCategoryRows.map((r) => ({ name: r.name, value: Number(r.value) })),
      restockCount: restockRow[0]?.count ?? 0,
    },
    expiryRisk: {
      expired: { value: Number(expiryRisk.expired.value), batches: Number(expiryRisk.expired.batches) },
      within30: { value: Number(expiryRisk.within30.value), batches: Number(expiryRisk.within30.batches) },
      within90: { value: Number(expiryRisk.within90.value), batches: Number(expiryRisk.within90.batches) },
    },
  });
}
