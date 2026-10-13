"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requirePermission } from "@/lib/guards";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { dec, money } from "@/lib/money";
import { recordMovement, recomputeBalance, expireMarkBatches } from "@/server/inventory/stock-service";

/* ─────────────────── Stock adjustments (audited, reasoned) ─────────────────── */

const adjustSchema = z.object({
  businessId: z.string(),
  productId: z.string(),
  batchId: z.string().optional().nullable(),
  direction: z.enum(["IN", "OUT", "DAMAGE"]),
  quantity: z.number().positive(),
  reason: z.string().min(3).max(300),
});

export async function createStockAdjustment(input: unknown) {
  return guarded(async () => {
    const d = adjustSchema.parse(input);
    const ctx = await requirePermission(d.businessId, "inventory.adjust");
    const product = await db.product.findFirst({ where: { id: d.productId, businessId: ctx.businessId } });
    if (!product) throw new Error("Product not found.");

    const signed = d.direction === "IN" ? dec(d.quantity) : dec(d.quantity).neg();
    const movementType = d.direction === "IN" ? "ADJUSTMENT_IN" : d.direction === "DAMAGE" ? "DAMAGE" : "ADJUSTMENT_OUT";
    const unitCost = d.direction === "IN" ? product.costPrice : product.costPrice;

    const adj = await db.$transaction(async (tx) => {
      await expireMarkBatches(tx, ctx.businessId);
      if (d.batchId) {
        const batch = await tx.pharmacyBatch.findFirst({ where: { id: d.batchId, businessId: ctx.businessId } });
        if (!batch) throw new Error("Batch not found.");
        if (d.direction === "OUT" || d.direction === "DAMAGE") {
          if (dec(batch.quantityRemaining).lt(dec(d.quantity))) {
            throw new Error(`Batch has only ${batch.quantityRemaining} ${product.baseUnit}(s) remaining.`);
          }
        }
      } else {
        const balance = await tx.stockBalance.findUnique({ where: { productId: product.id } });
        if ((d.direction === "OUT" || d.direction === "DAMAGE") && dec(balance?.quantity ?? 0).lt(dec(d.quantity))) {
          throw new Error(`Stock balance (${balance?.quantity ?? 0}) is lower than the adjustment quantity.`);
        }
      }
      await recordMovement(tx, {
        businessId: ctx.businessId,
        productId: product.id,
        batchId: d.batchId ?? null,
        type: movementType as "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "DAMAGE",
        quantity: signed,
        unitCost,
        reason: d.reason,
        referenceType: "ADJUSTMENT",
        userId: ctx.userId,
      });
      // Deplete batch when fully emptied
      if (d.batchId) {
        const b = await tx.pharmacyBatch.findUnique({ where: { id: d.batchId } });
        if (b && dec(b.quantityRemaining).lte(0)) {
          await tx.pharmacyBatch.update({ where: { id: b.id }, data: { quantityRemaining: dec(0), status: "DEPLETED" } });
        }
      }
      return tx.stockAdjustment.create({
        data: {
          businessId: ctx.businessId,
          productId: product.id,
          batchId: d.batchId ?? null,
          type: movementType,
          quantity: dec(d.quantity),
          reason: d.reason,
          createdById: ctx.userId,
        },
      });
    });

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.STOCK_ADJUSTMENT,
      entityType: "Product",
      entityId: product.id,
      reason: d.reason,
      meta: { direction: d.direction, quantity: d.quantity, batchId: d.batchId, unit: product.baseUnit },
    });
    return { ok: true, adjustmentId: adj.id };
  });
}

/* ─────────────────── Batch management (pharmacy) ─────────────────── */

export async function setBatchStatus(businessId: string, batchId: string, status: "ACTIVE" | "QUARANTINED" | "EXPIRED") {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "inventory.batchManage");
    const batch = await db.pharmacyBatch.findFirst({ where: { id: batchId, businessId: ctx.businessId } });
    if (!batch) throw new Error("Batch not found.");
    await db.pharmacyBatch.update({ where: { id: batchId }, data: { status } });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: "BATCH_STATUS_CHANGE",
      entityType: "PharmacyBatch",
      entityId: batchId,
      meta: { from: batch.status, to: status, batchNumber: batch.batchNumber },
    });
    return { ok: true };
  });
}

export async function listBatches(businessId: string, filter?: "EXPIRING" | "EXPIRED" | "LOW") {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "inventory.view");
    await db.$transaction(async (tx) => expireMarkBatches(tx, ctx.businessId));
    const business = await db.business.findUnique({ where: { id: ctx.businessId }, select: { expiryWarningDays: true } });
    const warnDays = business?.expiryWarningDays ?? 90;
    const warnDate = new Date(Date.now() + warnDays * 864e5);

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (filter === "EXPIRING") where.status = "ACTIVE";
    if (filter === "EXPIRED") where.status = "EXPIRED";

    const batches = await db.pharmacyBatch.findMany({
      where,
      include: { product: { select: { name: true, sku: true, baseUnit: true, reorderLevel: true } }, supplier: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
    });
    return batches.filter((b) => {
      if (filter === "EXPIRING") return b.expiryDate <= warnDate && b.quantityRemaining.gt(0);
      if (filter === "LOW") return dec(b.quantityRemaining).lt(dec(b.product.reorderLevel));
      return true;
    });
  });
}

export async function listStockBalances(businessId: string, search?: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "inventory.view");
    const products = await db.product.findMany({
      where: {
        businessId: ctx.businessId,
        isActive: true,
        ...(search ? { name: { contains: search } } : {}),
      },
      include: { stockBalance: true, category: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      department: p.department,
      type: p.type,
      baseUnit: p.baseUnit,
      reorderLevel: p.reorderLevel,
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      quantity: p.stockBalance?.quantity ?? dec(0),
      isLow: dec(p.stockBalance?.quantity ?? 0).lt(dec(p.reorderLevel)),
      value: money(dec(p.stockBalance?.quantity ?? 0).mul(p.costPrice)),
      categoryName: p.category?.name ?? null,
    }));
  });
}

export async function listStockMovements(businessId: string, productId?: string, take = 100) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "inventory.view");
    return db.stockMovement.findMany({
      where: { businessId: ctx.businessId, ...(productId ? { productId } : {}) },
      include: { product: { select: { name: true, baseUnit: true } }, batch: { select: { batchNumber: true } }, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
  });
}

export async function repairBalance(businessId: string, productId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "inventory.adjust");
    const total = await db.$transaction(async (tx) => recomputeBalance(tx, ctx.businessId, productId));
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: "BALANCE_REPAIR",
      entityType: "Product",
      entityId: productId,
      meta: { recomputedTo: total.toString() },
    });
    return { ok: true, quantity: total };
  });
}
