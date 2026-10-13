"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requirePermission, AuthError } from "@/lib/guards";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { dec, money } from "@/lib/money";
import { createSaleCore, voidSaleCore, processRefundCore } from "@/server/sales/sale-service";
import { expireMarkBatches, recordMovement } from "@/server/inventory/stock-service";
import { nextDocNumber } from "@/lib/serial";

/* ─────────────────────────── Catalogue for POS ─────────────────────────── */

export async function getPosCatalog(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "pos.sell");
    await db.$transaction(async (tx) => expireMarkBatches(tx, ctx.businessId));

    const [products, business] = await Promise.all([
      db.product.findMany({
        where: { businessId: ctx.businessId, isActive: true },
        include: {
          barcodes: { select: { code: true } },
          conversions: true,
          stockBalance: { select: { quantity: true } },
        },
        orderBy: { name: "asc" },
      }),
      db.business.findUnique({ where: { id: ctx.businessId }, select: { name: true, receiptHeader: true, receiptFooter: true, defaultTaxRate: true } }),
    ]);

    return {
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcodes: p.barcodes.map((b) => b.code),
        department: p.department,
        type: p.type,
        trackBatches: p.trackBatches,
        sellingPrice: p.sellingPrice,
        taxRate: p.taxRate,
        baseUnit: p.baseUnit,
        conversions: p.conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: c.factor })),
        stock: p.stockBalance?.quantity ?? dec(0),
      })),
      business,
      serverTime: new Date().toISOString(),
    };
  });
}

/* ─────────────────────────── Complete sale ─────────────────────────── */

const saleSchema = z.object({
  businessId: z.string(),
  shiftId: z.string().optional().nullable(),
  lines: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
    soldUnit: z.string().min(1),
    discountAmount: z.number().min(0).optional().default(0),
  })).min(1).max(200),
  payments: z.array(z.object({
    method: z.enum(["CASH", "TRANSFER", "CARD"]),
    amount: z.number().positive(),
    reference: z.string().max(120).optional().nullable(),
  })).min(1).max(4),
  transactionDiscount: z.number().min(0).optional().default(0),
  idempotencyKey: z.string().min(8).max(64),
  clientCreatedAt: z.string().optional().nullable(),
  offline: z.boolean().optional().default(false),
});

export async function completeSale(input: unknown) {
  return guarded(async () => {
    const d = saleSchema.parse(input);
    const ctx = await requirePermission(d.businessId, "pos.sell");

    // Discount permission enforcement (server-side, not UI)
    const hasLineDisc = d.lines.some((l) => (l.discountAmount ?? 0) > 0);
    const hasTxDisc = (d.transactionDiscount ?? 0) > 0;
    if (hasLineDisc && !ctx.permissions.has("pos.discountLine")) {
      throw new AuthError("PERMISSION_DENIED", "Your role cannot apply line-item discounts.");
    }
    if (hasTxDisc && !ctx.permissions.has("pos.discountTransaction")) {
      throw new AuthError("PERMISSION_DENIED", "Your role cannot apply transaction-level discounts.");
    }

    // Verify shift belongs to this cashier & business & is open
    let shiftId = d.shiftId ?? null;
    if (shiftId) {
      const shift = await db.cashierShift.findFirst({ where: { id: shiftId, businessId: ctx.businessId, userId: ctx.userId, status: "OPEN" } });
      if (!shift) shiftId = null;
    }

    const result = await db.$transaction(async (tx) => {
      return createSaleCore(tx, {
        businessId: ctx.businessId,
        cashierId: ctx.userId,
        shiftId,
        lines: d.lines.map((l) => ({
          productId: l.productId,
          quantity: dec(l.quantity),
          soldUnit: l.soldUnit,
          discountAmount: dec(l.discountAmount ?? 0),
        })),
        payments: d.payments.map((p) => ({ method: p.method, amount: dec(p.amount), reference: p.reference ?? null })),
        idempotencyKey: d.idempotencyKey,
        channel: d.offline ? "OFFLINE_SYNC" : "ONLINE",
        clientCreatedAt: d.clientCreatedAt ? new Date(d.clientCreatedAt) : null,
        allowShortfall: d.offline === true,
        transactionDiscount: dec(d.transactionDiscount ?? 0),
      });
    });

    const sale = await db.sale.findUnique({ where: { id: result.saleId } });

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.SALE_COMPLETED,
      entityType: "Sale",
      entityId: result.saleId,
      meta: { number: result.number, total: result.total.toString(), channel: d.offline ? "OFFLINE_SYNC" : "ONLINE" },
    });

    return {
      ok: true,
      saleId: result.saleId,
      number: result.number,
      total: result.total.toString(),
      changeGiven: result.changeGiven.toString(),
      balanceDue: result.balanceDue.toString(),
      shortfallWarnings: result.shortfallWarnings,
      receipt: sale ? await buildReceipt(ctx.businessId, sale.id) : null,
    };
  });
}

/* ─────────────────────────── Receipts ─────────────────────────── */

export async function buildReceipt(businessId: string, saleId: string) {
  const sale = await db.sale.findFirst({
    where: { id: saleId, businessId },
    include: {
      items: true,
      payments: true,
      cashier: { select: { name: true } },
      business: { select: { name: true, receiptHeader: true, receiptFooter: true, address: true, phone: true, logoUrl: true } },
    },
  });
  if (!sale) throw new Error("Sale not found.");
  return {
    number: sale.number,
    createdAt: sale.createdAt.toISOString(),
    cashier: sale.cashier.name,
    business: sale.business,
    items: sale.items.map((i) => ({
      name: i.productName,
      quantity: i.quantity,
      unit: i.soldUnit,
      unitPrice: i.unitPrice,
      discount: i.discountAmount,
      lineTotal: i.lineTotal,
      department: i.department,
    })),
    payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })),
    subtotal: sale.subtotal,
    discountTotal: sale.discountTotal,
    taxTotal: sale.taxTotal,
    total: sale.total,
    amountPaid: sale.amountPaid,
    changeGiven: sale.changeGiven,
    status: sale.status,
  };
}

export async function reprintReceipt(businessId: string, saleId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "pos.reprint");
    const sale = await db.sale.findFirst({ where: { id: saleId, businessId: ctx.businessId } });
    if (!sale) throw new Error("Sale not found.");
    await db.sale.update({ where: { id: saleId }, data: { reprintCount: { increment: 1 } } });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.SALE_REPRINTED,
      entityType: "Sale",
      entityId: saleId,
      meta: { number: sale.number },
    });
    return buildReceipt(ctx.businessId, saleId);
  });
}

/* ─────────────────────────── Sales history / detail ─────────────────────────── */

export async function listSales(businessId: string, opts?: { from?: string; to?: string; status?: string; search?: string; take?: number }) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "sale.view");
    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (opts?.from || opts?.to) {
      where.createdAt = {};
      if (opts.from) (where.createdAt as Record<string, unknown>).gte = new Date(opts.from);
      if (opts.to) (where.createdAt as Record<string, unknown>).lte = new Date(opts.to);
    }
    if (opts?.status && opts.status !== "ALL") where.status = opts.status;
    if (opts?.search) where.number = { contains: opts.search };
    return db.sale.findMany({
      where,
      include: {
        cashier: { select: { name: true } },
        items: { select: { id: true, department: true, lineTotal: true, productName: true, quantityBase: true } },
        payments: true,
      },
      orderBy: { createdAt: "desc" },
      take: opts?.take ?? 100,
    });
  });
}

/* ─────────────────────────── Voids ─────────────────────────── */

export async function voidSale(businessId: string, saleId: string, reason: string) {
  return guarded(async () => {
    const d = z.object({ reason: z.string().min(5).max(300) }).parse({ reason });
    const ctx = await requirePermission(businessId, "sale.void");
    await db.$transaction(async (tx) => {
      await voidSaleCore(tx, { businessId: ctx.businessId, saleId, voidedById: ctx.userId, reason: d.reason });
    });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.SALE_VOIDED,
      entityType: "Sale",
      entityId: saleId,
      reason: d.reason,
    });
    return { ok: true };
  });
}

/* ─────────────────────────── Refunds ─────────────────────────── */

export async function requestRefund(input: unknown) {
  return guarded(async () => {
    const d = z.object({
      businessId: z.string(),
      saleId: z.string(),
      reason: z.string().min(5).max(300),
      lines: z.array(z.object({ saleItemId: z.string(), quantity: z.number().positive(), restock: z.boolean().default(true) })).min(1),
    }).parse(input);
    const ctx = await requirePermission(d.businessId, "refund.request");

    const sale = await db.sale.findFirst({ where: { id: d.saleId, businessId: ctx.businessId }, include: { items: true, refunds: { where: { status: { in: ["PENDING", "APPROVED", "COMPLETED"] } }, include: { lines: true } } } });
    if (!sale) throw new Error("Sale not found.");
    if (sale.status === "VOIDED") throw new Error("A voided sale cannot be refunded.");

    // Compute amounts, capping at sold-minus-already-refunded
    let refundAmount = dec(0);
    const lineData: { saleItemId: string; productId: string; quantity: ReturnType<typeof dec>; amount: ReturnType<typeof dec>; restock: boolean }[] = [];
    for (const reqLine of d.lines) {
      const item = sale.items.find((i) => i.id === reqLine.saleItemId);
      if (!item) throw new Error("Sale item not found.");
      const alreadyRefunded = sale.refunds.flatMap((r) => r.lines).filter((l) => l.saleItemId === reqLine.saleItemId).reduce((acc, l) => acc.add(dec(l.quantity)), dec(0));
      const refundable = dec(item.quantityBase).minus(alreadyRefunded);
      if (refundable.lte(0)) throw new Error(`Item "${item.productName}" has already been fully refunded.`);
      if (dec(reqLine.quantity).gt(refundable)) {
        throw new Error(`Only ${refundable} of "${item.productName}" can still be refunded.`);
      }
      const unitNet = dec(item.quantityBase).gt(0) ? dec(item.lineTotal).minus(dec(item.taxAmount)).div(dec(item.quantityBase)) : dec(0);
      const amount = money(unitNet.mul(dec(reqLine.quantity)));
      refundAmount = refundAmount.add(amount);
      lineData.push({ saleItemId: item.id, productId: item.productId, quantity: dec(reqLine.quantity), amount, restock: reqLine.restock });
    }

    const refund = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, ctx.businessId, "RFD");
      const soldBase = dec(sale.items.reduce((acc, i) => acc.add(dec(i.quantityBase)), dec(0)));
      const refundedBase = lineData.reduce((acc, l) => acc.add(l.quantity), dec(0));
      return tx.refund.create({
        data: {
          businessId: ctx.businessId,
          saleId: sale.id,
          number,
          type: refundedBase.gte(soldBase) ? "FULL" : "PARTIAL",
          amount: money(refundAmount),
          reason: d.reason,
          status: "PENDING",
          requestedById: ctx.userId,
          lines: { create: lineData.map((l) => ({ saleItemId: l.saleItemId, productId: l.productId, quantity: l.quantity, amount: l.amount, restock: l.restock })) },
        },
      });
    });

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.REFUND_REQUESTED,
      entityType: "Refund",
      entityId: refund.id,
      reason: d.reason,
      meta: { number: refund.number, amount: refundAmount.toString(), saleNumber: sale.number },
    });

    // Auto-approve when the requester has approval permission
    if (ctx.permissions.has("refund.approve")) {
      return approveRefund(d.businessId, refund.id);
    }
    return { ok: true, refundId: refund.id, status: "PENDING", number: refund.number };
  });
}

export async function approveRefund(businessId: string, refundId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "refund.approve");
    const refund = await db.refund.findFirst({ where: { id: refundId, businessId: ctx.businessId } });
    if (!refund) throw new Error("Refund not found.");
    if (refund.status === "COMPLETED") return { ok: true, status: "COMPLETED" };
    if (refund.status === "REJECTED") throw new Error("A rejected refund cannot be approved.");

    await db.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: refundId }, data: { status: "APPROVED", approvedById: ctx.userId } });
      await processRefundCore(tx, { businessId: ctx.businessId, refundId, processedById: ctx.userId });
    });

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.REFUND_COMPLETED,
      entityType: "Refund",
      entityId: refundId,
      meta: { number: refund.number, amount: refund.amount.toString() },
    });
    return { ok: true, status: "COMPLETED" };
  });
}

export async function rejectRefund(businessId: string, refundId: string, reason: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "refund.approve");
    const refund = await db.refund.findFirst({ where: { id: refundId, businessId: ctx.businessId } });
    if (!refund) throw new Error("Refund not found.");
    if (refund.status === "COMPLETED") throw new Error("A completed refund cannot be rejected.");
    await db.refund.update({ where: { id: refundId }, data: { status: "REJECTED", approvedById: ctx.userId } });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.REFUND_REJECTED,
      entityType: "Refund",
      entityId: refundId,
      reason,
    });
    return { ok: true };
  });
}

export async function listRefunds(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "sale.view");
    return db.refund.findMany({
      where: { businessId: ctx.businessId },
      include: {
        sale: { select: { number: true } },
        requestedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        lines: { include: { saleItem: { select: { productName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
  });
}

/* ─────────────────────────── Shifts ─────────────────────────── */

export async function getMyShift(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "shift.own");
    const shift = await db.cashierShift.findFirst({
      where: { businessId: ctx.businessId, userId: ctx.userId, status: "OPEN" },
      include: { cashMovements: true },
      orderBy: { openedAt: "desc" },
    });
    if (!shift) return { shift: null };
    const cashNet = shift.cashMovements.reduce((acc, m) => acc.add(dec(m.amount)), dec(0));
    const salesAgg = await db.sale.aggregate({ where: { shiftId: shift.id, status: { not: "VOIDED" } }, _sum: { total: true }, _count: true });
    return {
      shift: {
        id: shift.id,
        openedAt: shift.openedAt.toISOString(),
        openingCash: shift.openingCash,
        expectedCash: cashNet,
        salesCount: salesAgg._count,
        salesTotal: salesAgg._sum.total ?? dec(0),
      },
    };
  });
}

export async function openShift(businessId: string, openingCash: number) {
  return guarded(async () => {
    const d = z.object({ openingCash: z.number().min(0) }).parse({ openingCash });
    const ctx = await requirePermission(businessId, "shift.own");
    const existing = await db.cashierShift.findFirst({ where: { businessId: ctx.businessId, userId: ctx.userId, status: "OPEN" } });
    if (existing) throw new Error("You already have an open shift. Close it first.");
    const shift = await db.$transaction(async (tx) => {
      const created = await tx.cashierShift.create({
        data: { businessId: ctx.businessId, userId: ctx.userId, status: "OPEN", openingCash: money(d.openingCash) },
      });
      await tx.cashMovement.create({
        data: { businessId: ctx.businessId, shiftId: created.id, type: "OPENING", amount: money(d.openingCash), userId: ctx.userId, reason: "Opening float" },
      });
      return created;
    });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.SHIFT_OPENED,
      entityType: "CashierShift",
      entityId: shift.id,
      meta: { openingCash: d.openingCash },
    });
    return { ok: true, shiftId: shift.id };
  });
}

export async function closeShift(businessId: string, countedCash: number, notes?: string) {
  return guarded(async () => {
    const d = z.object({ countedCash: z.number().min(0), notes: z.string().max(300).optional() }).parse({ countedCash, notes });
    const ctx = await requirePermission(businessId, "shift.own");
    const shift = await db.cashierShift.findFirst({ where: { businessId: ctx.businessId, userId: ctx.userId, status: "OPEN" } });
    if (!shift) throw new Error("No open shift to close.");

    const cashAgg = await db.cashMovement.aggregate({ where: { shiftId: shift.id, type: { in: ["OPENING", "SALE", "REFUND", "DROP", "PAYOUT"] } }, _sum: { amount: true } });
    const expectedCash = money(dec(cashAgg._sum.amount ?? 0));
    const discrepancy = money(dec(d.countedCash).minus(expectedCash));
    const salesAgg = await db.sale.aggregate({ where: { shiftId: shift.id, status: { not: "VOIDED" } }, _sum: { total: true }, _count: true });

    await db.$transaction(async (tx) => {
      await tx.cashierShift.update({
        where: { id: shift.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          expectedCash,
          countedCash: money(d.countedCash),
          discrepancy,
          notes: d.notes || null,
          totalsJson: JSON.stringify({ salesCount: salesAgg._count, salesTotal: (salesAgg._sum.total ?? 0).toString(), expectedCash: expectedCash.toString() }),
        },
      });
      await tx.cashMovement.create({
        data: { businessId: ctx.businessId, shiftId: shift.id, type: "CLOSING", amount: money(d.countedCash).neg(), userId: ctx.userId, reason: "Shift closing (drawer swept)" },
      });
    });

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.SHIFT_CLOSED,
      entityType: "CashierShift",
      entityId: shift.id,
      meta: { expectedCash: expectedCash.toString(), countedCash: d.countedCash.toString(), discrepancy: discrepancy.toString() },
    });
    return { ok: true, expectedCash: expectedCash.toString(), discrepancy: discrepancy.toString() };
  });
}

export async function cashDrop(businessId: string, amount: number, reason: string) {
  return guarded(async () => {
    const d = z.object({ amount: z.number().positive(), reason: z.string().min(3).max(200) }).parse({ amount, reason });
    const ctx = await requirePermission(businessId, "shift.own");
    const shift = await db.cashierShift.findFirst({ where: { businessId: ctx.businessId, userId: ctx.userId, status: "OPEN" } });
    if (!shift) throw new Error("No open shift.");
    await db.cashMovement.create({
      data: { businessId: ctx.businessId, shiftId: shift.id, type: "DROP", amount: money(d.amount).neg(), userId: ctx.userId, reason: d.reason },
    });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: "CASH_DROP",
      entityType: "CashierShift",
      entityId: shift.id,
      reason: d.reason,
      meta: { amount: d.amount },
    });
    return { ok: true };
  });
}

export async function listShifts(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "shift.viewAll");
    return db.cashierShift.findMany({
      where: { businessId: ctx.businessId },
      include: { user: { select: { name: true } } },
      orderBy: { openedAt: "desc" },
      take: 50,
    });
  });
}

/* ─────────────────────────── Offline sync ─────────────────────────── */

export async function syncOfflineSale(payload: unknown) {
  // Same as completeSale but allows offline rules; kept separate for clarity
  return completeSale({ ...(payload as Record<string, unknown>), offline: true });
}
