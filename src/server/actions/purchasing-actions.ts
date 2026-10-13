"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requirePermission } from "@/lib/guards";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { dec, money } from "@/lib/money";
import { nextDocNumber } from "@/lib/serial";
import { receiveGoodsCore } from "@/server/inventory/goods-receipt-service";

/* ─────────────────────────── Suppliers ─────────────────────────── */

const supplierSchema = z.object({
  businessId: z.string(),
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  contactName: z.string().max(80).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(200).optional(),
  category: z.string().max(60).optional(),
  paymentTerms: z.string().max(60).optional(),
  notes: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
});

export async function saveSupplier(input: unknown) {
  return guarded(async () => {
    const d = supplierSchema.parse(input);
    const ctx = await requirePermission(d.businessId, "supplier.manage");
    const data = {
      name: d.name,
      contactName: d.contactName || null,
      phone: d.phone || null,
      email: d.email || null,
      address: d.address || null,
      category: d.category || null,
      paymentTerms: d.paymentTerms || null,
      notes: d.notes || null,
      isActive: d.isActive,
    };
    let supplier;
    if (d.id) {
      supplier = await db.supplier.findFirst({ where: { id: d.id, businessId: ctx.businessId } });
      if (!supplier) throw new Error("Supplier not found.");
      supplier = await db.supplier.update({ where: { id: d.id }, data });
    } else {
      supplier = await db.supplier.create({ data: { ...data, businessId: ctx.businessId } });
    }
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.SUPPLIER_SAVED,
      entityType: "Supplier",
      entityId: supplier.id,
      meta: { name: d.name, created: !d.id },
    });
    return { ok: true, supplier };
  });
}

export async function listSuppliers(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "supplier.view");
    return db.supplier.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { name: "asc" },
    });
  });
}

/* ─────────────────────────── Purchase orders ─────────────────────────── */

const poSchema = z.object({
  businessId: z.string(),
  supplierId: z.string(),
  expectedDate: z.string().optional().nullable(),
  notes: z.string().max(500).optional(),
  lines: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
    unitCost: z.number().min(0),
  })).min(1).max(100),
});

export async function createPurchaseOrder(input: unknown) {
  return guarded(async () => {
    const d = poSchema.parse(input);
    const ctx = await requirePermission(d.businessId, "po.manage");
    const supplier = await db.supplier.findFirst({ where: { id: d.supplierId, businessId: ctx.businessId } });
    if (!supplier) throw new Error("Supplier not found.");

    const po = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, ctx.businessId, "PO");
      const products = await tx.product.findMany({ where: { id: { in: d.lines.map((l) => l.productId) }, businessId: ctx.businessId } });
      if (products.length !== new Set(d.lines.map((l) => l.productId)).size) throw new Error("One or more products not found in your business.");

      const total = money(d.lines.reduce((acc, l) => acc.add(dec(l.quantity).mul(dec(l.unitCost))), dec(0)));
      const created = await tx.purchaseOrder.create({
        data: {
          businessId: ctx.businessId,
          supplierId: d.supplierId,
          number,
          status: "ORDERED",
          expectedDate: d.expectedDate ? new Date(d.expectedDate) : null,
          notes: d.notes || null,
          total,
        },
      });
      for (const line of d.lines) {
        await tx.purchaseOrderLine.create({
          data: { poId: created.id, productId: line.productId, quantity: dec(line.quantity), unitCost: dec(line.unitCost) },
        });
      }
      return created;
    });

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.PO_CREATED,
      entityType: "PurchaseOrder",
      entityId: po.id,
      meta: { number: po.number, supplier: supplier.name, total: po.total.toString() },
    });
    return { ok: true, po };
  });
}

export async function listPurchaseOrders(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "po.manage");
    return db.purchaseOrder.findMany({
      where: { businessId: ctx.businessId },
      include: {
        supplier: { select: { name: true } },
        lines: { include: { product: { select: { name: true, baseUnit: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
}

/* ─────────────────────────── Goods receiving ─────────────────────────── */

const receiveSchema = z.object({
  businessId: z.string(),
  supplierId: z.string(),
  poId: z.string().optional().nullable(),
  notes: z.string().max(500).optional(),
  onCredit: z.boolean().default(true),
  lines: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
    unitCost: z.number().min(0),
    batchNumber: z.string().optional().nullable(),
    expiryDate: z.string().optional().nullable(), // ISO date string
  })).min(1).max(200),
});

export async function receiveGoods(input: unknown) {
  return guarded(async () => {
    const d = receiveSchema.parse(input);
    const ctx = await requirePermission(d.businessId, "inventory.receive");

    const result = await db.$transaction(async (tx) => {
      return receiveGoodsCore(tx, {
        businessId: ctx.businessId,
        supplierId: d.supplierId,
        poId: d.poId ?? null,
        receivedById: ctx.userId,
        notes: d.notes || null,
        onCredit: d.onCredit,
        lines: d.lines.map((l) => ({
          productId: l.productId,
          quantity: dec(l.quantity),
          unitCost: dec(l.unitCost),
          batchNumber: l.batchNumber || null,
          expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
        })),
      });
    });

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.GOODS_RECEIVED,
      entityType: "GoodsReceipt",
      entityId: result.receiptId,
      meta: { number: result.number, supplierId: d.supplierId, lines: d.lines.length, onCredit: d.onCredit },
    });
    return { ok: true, number: result.number, receiptId: result.receiptId };
  });
}

export async function listGoodsReceipts(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "inventory.view");
    return db.goodsReceipt.findMany({
      where: { businessId: ctx.businessId },
      include: {
        supplier: { select: { name: true } },
        receivedBy: { select: { name: true } },
        lines: { include: { product: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });
}

export async function paySupplierBalance(businessId: string, supplierId: string, amount: number, method: string, note?: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "supplier.manage");
    const supplier = await db.supplier.findFirst({ where: { id: supplierId, businessId: ctx.businessId } });
    if (!supplier) throw new Error("Supplier not found.");
    if (amount <= 0) throw new Error("Payment amount must be positive.");
    if (dec(supplier.balance).lt(dec(amount))) throw new Error("Payment exceeds the outstanding balance.");
    await db.$transaction(async (tx) => {
      await tx.supplier.update({ where: { id: supplierId }, data: { balance: { decrement: money(amount) } } });
      // Attach payout to the open shift; else a system shift for traceability
      let shift = await tx.cashierShift.findFirst({ where: { businessId: ctx.businessId, status: "OPEN" } });
      if (!shift) {
        shift = await tx.cashierShift.create({
          data: {
            businessId: ctx.businessId, userId: ctx.userId, status: "CLOSED",
            openedAt: new Date(), closedAt: new Date(), openingCash: dec(0),
            closingCash: dec(0), expectedCash: dec(0), countedCash: dec(0), discrepancy: dec(0),
            notes: "System shift (financial operation outside POS)",
          },
        });
      }
      await tx.cashMovement.create({
        data: {
          businessId: ctx.businessId,
          shiftId: shift.id,
          type: "PAYOUT",
          amount: money(amount).neg(),
          reason: `Supplier payment — ${supplier.name}${note ? ` (${note})` : ""}`,
          userId: ctx.userId,
        },
      });
    });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: "SUPPLIER_PAYMENT",
      entityType: "Supplier",
      entityId: supplierId,
      meta: { amount: amount.toString(), method },
    });
    return { ok: true };
  });
}
