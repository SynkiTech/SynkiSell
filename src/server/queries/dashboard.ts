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

  // 14-day sparkline for the chart
  const sparkline = await db.$queryRaw<{ day: string; total: number }[]>`
    SELECT date(createdAt / 1000, 'unixepoch') as day, CAST(SUM(total) AS REAL) as total
    FROM Sale
    WHERE businessId = ${bid} AND status = 'COMPLETED' AND createdAt >= ${startOfDay(13)}
    GROUP BY date(createdAt) ORDER BY day ASC`;
  const sparklineFilled: { day: string; total: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = startOfDay(i).toISOString().slice(0, 10);
    const found = sparkline.find((s) => s.day === day);
    sparklineFilled.push({ day, total: found ? Number(found.total) : 0 });
  }

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
    sparkline: sparklineFilled,
  });
}
