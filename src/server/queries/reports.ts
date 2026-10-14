"use server";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dec, money, toPlain } from "@/lib/money";
import { requirePermission } from "@/lib/guards";
import { expireMarkBatches } from "@/server/inventory/stock-service";

const D = Prisma.Decimal;

export type ReportBundle = Awaited<ReturnType<typeof getReports>>;
export type InventoryReportBundle = Awaited<ReturnType<typeof getInventoryReports>>;

/** Sales report with period + grouping. All figures from real records. */
export async function getReports(
  businessId: string,
  opts: { from: string; to: string; groupBy?: "DAY" | "MONTH" }
) {
  const ctx = await requirePermission(businessId, "reports.view");
  const bid = ctx.businessId;
  const from = new Date(opts.from);
  const to = new Date(opts.to);
  to.setHours(23, 59, 59, 999);

  const completedWhere = { businessId: bid, status: "COMPLETED" as const, createdAt: { gte: from, lte: to } };

  const [salesAgg, refundsAgg, voidsAgg, byDept, byCashier, byProduct, expensesAgg, payments, discountAgg] = await Promise.all([
    db.sale.aggregate({ where: completedWhere, _sum: { total: true, discountTotal: true, taxTotal: true }, _count: true }),
    db.refund.aggregate({ where: { businessId: bid, status: "COMPLETED", createdAt: { gte: from, lte: to } }, _sum: { amount: true }, _count: true }),
    db.sale.aggregate({ where: { businessId: bid, status: "VOIDED", updatedAt: { gte: from, lte: to } }, _sum: { total: true }, _count: true }),
    db.saleItem.groupBy({ by: ["department"], where: { businessId: bid, sale: completedWhere }, _sum: { lineTotal: true, quantityBase: true } }),
    db.sale.groupBy({ by: ["cashierId"], where: completedWhere, _sum: { total: true }, _count: true }),
    db.saleItem.groupBy({ by: ["productId", "productName"], where: { businessId: bid, sale: completedWhere }, _sum: { quantityBase: true, lineTotal: true, taxAmount: true } }),
    db.expense.aggregate({ where: { businessId: bid, status: "APPROVED", date: { gte: from, lte: to } }, _sum: { amount: true } }),
    db.salePayment.findMany({ where: { sale: completedWhere }, select: { method: true, amount: true } }),
    db.sale.aggregate({ where: completedWhere, _sum: { discountTotal: true } }),
  ]);

  // COGS & gross profit per product + total
  const items = await db.saleItem.findMany({
    where: { businessId: bid, sale: completedWhere },
    select: { productId: true, productName: true, costPrice: true, quantityBase: true, lineTotal: true, taxAmount: true, department: true },
  });
  const cogsByProduct = new Map<string, Prisma.Decimal>();
  let cogsTotal = new D(0);
  for (const it of items) {
    const c = dec(it.costPrice).mul(dec(it.quantityBase));
    cogsTotal = cogsTotal.add(c);
    cogsByProduct.set(it.productId, (cogsByProduct.get(it.productId) ?? new D(0)).add(c));
  }
  const grossProfit = dec(salesAgg._sum.total ?? 0).minus(dec(salesAgg._sum.taxTotal ?? 0)).minus(cogsTotal).minus(dec(refundsAgg._sum.amount ?? 0));

  const cashierIds = byCashier.map((c) => c.cashierId);
  const cashiers = await db.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } });

  const paymentMix: Record<string, Prisma.Decimal> = {};
  for (const p of payments) paymentMix[p.method] = (paymentMix[p.method] ?? new D(0)).add(dec(p.amount));

  const topProducts = byProduct
    .map((p) => ({
      name: p.productName,
      qty: p._sum.quantityBase ?? dec(0),
      revenue: money(p._sum.lineTotal ?? 0),
      cogs: money(cogsByProduct.get(p.productId) ?? 0),
      profit: money(dec(p._sum.lineTotal ?? 0).minus(dec(p._sum.taxAmount ?? 0)).minus(cogsByProduct.get(p.productId) ?? 0)),
    }))
    .sort((a, b) => b.revenue.comparedTo(a.revenue))
    .slice(0, 20);

  // Daily series for charting (PostgreSQL-native date_trunc)
  const series = await db.$queryRaw<{ day: string; total: number; count: number }[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
           SUM("total")::float8 AS total, COUNT(*)::int AS count
    FROM "Sale" WHERE "businessId" = ${bid} AND "status" = 'COMPLETED'
    AND "createdAt" >= ${from} AND "createdAt" <= ${to}
    GROUP BY 1 ORDER BY 1`;

  return toPlain({
    period: { from: opts.from, to: opts.to, generatedAt: new Date().toISOString() },
    sales: {
      total: money(salesAgg._sum.total ?? 0),
      count: salesAgg._count,
      discounts: money(salesAgg._sum.discountTotal ?? 0),
      tax: money(salesAgg._sum.taxTotal ?? 0),
    },
    refunds: { total: money(refundsAgg._sum.amount ?? 0), count: refundsAgg._count },
    voids: { total: money(voidsAgg._sum.total ?? 0), count: voidsAgg._count },
    cogs: money(cogsTotal),
    grossProfit: money(grossProfit),
    expenses: money(expensesAgg._sum.amount ?? 0),
    netBeforeTax: money(grossProfit.minus(dec(expensesAgg._sum.amount ?? 0))),
    byDept: byDept.map((d) => ({ department: d.department, revenue: money(d._sum.lineTotal ?? 0), qty: d._sum.quantityBase ?? dec(0) })),
    byCashier: byCashier.map((c) => ({
      name: cashiers.find((u) => u.id === c.cashierId)?.name ?? "Unknown",
      total: money(c._sum.total ?? 0),
      count: c._count,
    })),
    paymentMix: Object.fromEntries(Object.entries(paymentMix).map(([k, v]) => [k, money(v)])),
    topProducts,
    series,
  });
}

/** Inventory valuation + expiry exposure + low stock list. */
export async function getInventoryReports(businessId: string) {
  const ctx = await requirePermission(businessId, "reports.view");
  const bid = ctx.businessId;
  await db.$transaction(async (tx) => expireMarkBatches(tx, bid));

  const balances = await db.stockBalance.findMany({
    where: { businessId: bid, quantity: { gt: 0 } },
    include: { product: { select: { name: true, sku: true, baseUnit: true, costPrice: true, reorderLevel: true, department: true } } },
  });
  const totalValue = balances.reduce((acc, b) => acc.add(dec(b.quantity).mul(b.product.costPrice)), new D(0));

  const lowStock = balances
    .filter((b) => dec(b.quantity).lt(dec(b.product.reorderLevel)))
    .map((b) => ({ name: b.product.name, quantity: b.quantity, reorderLevel: b.product.reorderLevel, baseUnit: b.product.baseUnit, department: b.product.department }));

  const warnDate = new Date(Date.now() + 90 * 864e5);
  const batches = await db.pharmacyBatch.findMany({
    where: { businessId: bid, quantityRemaining: { gt: 0 }, expiryDate: { lte: warnDate } },
    include: { product: { select: { name: true, sku: true, baseUnit: true } } },
    orderBy: { expiryDate: "asc" },
  });
  const expiringValue = batches.filter((b) => b.status === "ACTIVE").reduce((acc, b) => acc.add(dec(b.quantityRemaining).mul(b.unitCost)), new D(0));
  const expiredValue = batches.filter((b) => b.status === "EXPIRED").reduce((acc, b) => acc.add(dec(b.quantityRemaining).mul(b.unitCost)), new D(0));

  const adjustments = await db.stockAdjustment.findMany({
    where: { businessId: bid, createdAt: { gte: new Date(Date.now() - 30 * 864e5) } },
    include: { product: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  // Fast / slow movers (last 30 days by qty sold)
  const movers = await db.saleItem.groupBy({
    by: ["productId", "productName"],
    where: { businessId: bid, sale: { status: "COMPLETED", createdAt: { gte: new Date(Date.now() - 30 * 864e5) } } },
    _sum: { quantityBase: true, lineTotal: true },
  });
  const sortedMovers = movers.sort((a, b) => dec(b._sum.quantityBase ?? 0).comparedTo(dec(a._sum.quantityBase ?? 0)));
  const fast = sortedMovers.slice(0, 10).map((m) => ({ name: m.productName, qty: m._sum.quantityBase ?? dec(0), revenue: money(m._sum.lineTotal ?? 0) }));
  const soldIds = new Set(movers.map((m) => m.productId));
  const neverSold = await db.product.findMany({
    where: { businessId: bid, isActive: true, id: { notIn: [...soldIds] } },
    select: { name: true, baseUnit: true },
    take: 10,
  });

  return toPlain({
    generatedAt: new Date().toISOString(),
    valuation: { total: money(totalValue), productCount: balances.length },
    lowStock,
    batches: batches.map((b) => ({
      productName: b.product.name,
      batchNumber: b.batchNumber,
      expiryDate: b.expiryDate.toISOString(),
      status: b.status,
      quantityRemaining: b.quantityRemaining,
      baseUnit: b.product.baseUnit,
      valueAtCost: money(dec(b.quantityRemaining).mul(b.unitCost)),
      daysLeft: Math.ceil((b.expiryDate.getTime() - Date.now()) / 864e5),
    })),
    expiringValue: money(expiringValue),
    expiredValue: money(expiredValue),
    adjustments: adjustments.map((a) => ({ productName: a.product.name, type: a.type, quantity: a.quantity, reason: a.reason, createdAt: a.createdAt.toISOString() })),
    fastMovers: fast,
    neverSold,
  });
}
