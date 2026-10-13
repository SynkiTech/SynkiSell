import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dec, money } from "@/lib/money";
import { requirePermission, type Permission } from "@/lib/guards";
import { expireMarkBatches } from "@/server/inventory/stock-service";

const D = Prisma.Decimal;

/**
 * Validated, tenant-scoped aggregate functions — the ONLY data path the AI
 * can see. Each tool: zod-validated args, businessId pinned server-side,
 * returns compact JSON. The LLM NEVER sees raw SQL or other tenants' data.
 */

export type ToolResult = { tool: string; period?: string; basis?: string; data: unknown };

export async function runAiTool(businessId: string, permission: Permission, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  const ctx = await requirePermission(businessId, permission);
  const bid = ctx.businessId;
  const days = Math.max(1, Math.min(365, Number(args.days ?? 7)));
  const from = new Date(Date.now() - days * 864e5);
  const period = `last ${days} day(s) (${from.toISOString().slice(0, 10)} → ${new Date().toISOString().slice(0, 10)})`;

  switch (tool) {
    case "salesSummary": {
      const agg = await db.sale.aggregate({ where: { businessId: bid, status: "COMPLETED", createdAt: { gte: from } }, _sum: { total: true, discountTotal: true }, _count: true });
      const items = await db.saleItem.findMany({ where: { businessId: bid, sale: { status: "COMPLETED", createdAt: { gte: from } } }, select: { lineTotal: true, taxAmount: true, costPrice: true, quantityBase: true, department: true } });
      const cogs = items.reduce((a, i) => a.add(dec(i.costPrice).mul(dec(i.quantityBase))), new D(0));
      const grossProfit = items.reduce((a, i) => a.add(dec(i.lineTotal).minus(dec(i.taxAmount)).minus(dec(i.costPrice).mul(dec(i.quantityBase)))), new D(0));
      const byDept: Record<string, number> = {};
      for (const i of items) byDept[i.department] = (byDept[i.department] ?? 0) + Number(i.lineTotal);
      return { tool, period, basis: "completed sales; gross profit = revenue − product cost (operating expenses excluded)", data: { totalSales: Number(agg._sum.total ?? 0), salesCount: agg._count, discounts: Number(agg._sum.discountTotal ?? 0), grossProfit: Number(grossProfit), cogs: Number(cogs), byDepartment: byDept } };
    }
    case "comparePeriods": {
      const cur = await db.sale.aggregate({ where: { businessId: bid, status: "COMPLETED", createdAt: { gte: from } }, _sum: { total: true }, _count: true });
      const prev = await db.sale.aggregate({ where: { businessId: bid, status: "COMPLETED", createdAt: { gte: new Date(from.getTime() - days * 864e5), lt: from } }, _sum: { total: true }, _count: true });
      return { tool, period, basis: "completed sales, current vs previous equal-length period", data: { current: Number(cur._sum.total ?? 0), previous: Number(prev._sum.total ?? 0), currentCount: cur._count, previousCount: prev._count } };
    }
    case "topProducts": {
      const rows = await db.saleItem.groupBy({ by: ["productName"], where: { businessId: bid, sale: { status: "COMPLETED", createdAt: { gte: from } } }, _sum: { lineTotal: true, quantityBase: true }, orderBy: { _sum: { lineTotal: "desc" } }, take: Number(args.limit ?? 5) });
      return { tool, period, basis: "sales line items", data: rows.map((r) => ({ name: r.productName, revenue: Number(r._sum.lineTotal ?? 0), qty: Number(r._sum.quantityBase ?? 0) })) };
    }
    case "slowMovers": {
      const sold = await db.saleItem.groupBy({ by: ["productId"], where: { businessId: bid, sale: { status: "COMPLETED", createdAt: { gte: from } } }, _sum: { quantityBase: true } });
      const soldIds = sold.map((s) => s.productId);
      const products = await db.product.findMany({ where: { businessId: bid, isActive: true, OR: [{ id: { notIn: soldIds } }, { stockBalance: { quantity: { gt: 0 } } }] }, include: { stockBalance: true }, take: 100 });
      const soldMap = new Map(sold.map((s) => [s.productId, s._sum.quantityBase ?? 0]));
      const rows = products.map((p) => ({ name: p.name, soldQty: Number(soldMap.get(p.id) ?? 0), stock: Number(p.stockBalance?.quantity ?? 0) })).sort((a, b) => a.soldQty - b.soldQty).slice(0, Number(args.limit ?? 8));
      return { tool, period, basis: "products with lowest or zero recorded sales", data: rows };
    }
    case "lowStock": {
      const balances = await db.stockBalance.findMany({ where: { businessId: bid, product: { isActive: true } }, include: { product: { select: { name: true, baseUnit: true, reorderLevel: true, department: true } } } });
      const low = balances.filter((b) => dec(b.quantity).lt(dec(b.product.reorderLevel))).map((b) => ({ name: b.product.name, stock: Number(b.quantity), reorderLevel: Number(b.product.reorderLevel), unit: b.product.baseUnit, department: b.product.department }));
      return { tool, period: "now", basis: "cached balance < reorder threshold", data: low.slice(0, 20) };
    }
    case "expiringStock": {
      await db.$transaction(async (tx) => expireMarkBatches(tx, bid));
      const daysAhead = Math.min(365, Math.max(1, Number(args.days ?? 60)));
      const batches = await db.pharmacyBatch.findMany({ where: { businessId: bid, quantityRemaining: { gt: 0 }, expiryDate: { lte: new Date(Date.now() + daysAhead * 864e5) } }, include: { product: { select: { name: true, baseUnit: true } } }, orderBy: { expiryDate: "asc" }, take: 20 });
      return { tool, period: `expiring within ${daysAhead} days`, basis: "batch remaining × batch unit cost", data: batches.map((b) => ({ productName: b.product.name, batchNumber: b.batchNumber, expiryDate: b.expiryDate.toISOString().slice(0, 10), status: b.status, qty: Number(b.quantityRemaining), unit: b.product.baseUnit, valueAtCost: Number(dec(b.quantityRemaining).mul(b.unitCost)) })) };
    }
    case "supplierPriceChanges": {
      const receipts = await db.goodsReceipt.findMany({ where: { businessId: bid, createdAt: { gte: from } }, include: { lines: { include: { product: { select: { name: true } } } }, supplier: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 60 });
      const changes: { supplier: string; product: string; unitCost: number }[] = [];
      for (const r of receipts) for (const l of r.lines) changes.push({ supplier: r.supplier.name, product: l.product.name, unitCost: Number(l.unitCost) });
      return { tool, period, basis: "recorded unit costs on goods receipts", data: changes.slice(0, 20) };
    }
    case "stockAdjustments": {
      const adj = await db.stockAdjustment.findMany({ where: { businessId: bid, createdAt: { gte: from } }, include: { product: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 });
      return { tool, period, basis: "adjustment records with reasons", data: adj.map((a) => ({ productName: a.product.name, type: a.type, quantity: Number(a.quantity), reason: a.reason })) };
    }
    case "cashierPerformance": {
      const rows = await db.sale.groupBy({ by: ["cashierId"], where: { businessId: bid, status: "COMPLETED", createdAt: { gte: from } }, _sum: { total: true }, _count: true });
      const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.cashierId) } }, select: { id: true, name: true } });
      return { tool, period, basis: "completed sales per cashier", data: rows.map((r) => ({ name: users.find((u) => u.id === r.cashierId)?.name ?? "Unknown", total: Number(r._sum.total ?? 0), sales: r._count })) };
    }
    case "expenses": {
      const agg = await db.expense.aggregate({ where: { businessId: bid, status: "APPROVED", date: { gte: from } }, _sum: { amount: true }, _count: true });
      const byCat = await db.expense.groupBy({ by: ["categoryId"], where: { businessId: bid, status: "APPROVED", date: { gte: from } }, _sum: { amount: true } });
      const cats = await db.expenseCategory.findMany({ where: { businessId: bid } });
      return { tool, period, basis: "approved expenses only", data: { total: Number(agg._sum.amount ?? 0), count: agg._count, byCategory: byCat.map((c) => ({ category: cats.find((x) => x.id === c.categoryId)?.name ?? "Other", total: Number(c._sum.amount ?? 0) })) } };
    }
    case "stockValuation": {
      const balances = await db.stockBalance.findMany({ where: { businessId: bid, quantity: { gt: 0 } }, include: { product: { select: { costPrice: true, name: true } } } });
      const total = balances.reduce((a, b) => a.add(dec(b.quantity).mul(b.product.costPrice)), new D(0));
      return { tool, period: "now", basis: "cached balance × latest product cost", data: { totalValue: Number(total), productsValued: balances.length } };
    }
    default:
      throw new Error(`Unknown tool "${tool}".`);
  }
}

export const AI_TOOLS = [
  { name: "salesSummary", description: "Total sales, count, discounts, gross profit, department split for a period", args: { days: "number of days back (1-365), default 7" } },
  { name: "comparePeriods", description: "Compare sales vs previous equal-length period", args: { days: "period length, default 7" } },
  { name: "topProducts", description: "Best-selling products by revenue", args: { days: "days back", limit: "how many, default 5" } },
  { name: "slowMovers", description: "Products with lowest or zero sales", args: { days: "days back", limit: "how many, default 8" } },
  { name: "lowStock", description: "Products at/below reorder threshold", args: {} },
  { name: "expiringStock", description: "Medicine batches expiring soon with value at risk", args: { days: "days ahead, default 60" } },
  { name: "supplierPriceChanges", description: "Recent recorded unit costs per supplier/product", args: { days: "days back" } },
  { name: "stockAdjustments", description: "Recent stock adjustments with reasons", args: { days: "days back" } },
  { name: "cashierPerformance", description: "Sales by cashier for a period", args: { days: "days back" } },
  { name: "expenses", description: "Approved operating expenses total & by category", args: { days: "days back" } },
  { name: "stockValuation", description: "Total stock value at cost", args: {} },
] as const;
