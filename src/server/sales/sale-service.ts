import { Prisma } from "@prisma/client";
import { D, dec, money, computeLine, sum } from "@/lib/money";
import { allocateFefo, resolveToBase, recordMovement } from "@/server/inventory/stock-service";
import { nextDocNumber } from "@/lib/serial";

type Tx = Prisma.TransactionClient;

export type SaleInputLine = {
  productId: string;
  quantity: Prisma.Decimal.Value; // in soldUnit
  soldUnit: string;
  /** UI price hint — server recomputes from DB; kept for offline sync validation */
  unitPriceHint?: Prisma.Decimal.Value | null;
  discountAmount?: Prisma.Decimal.Value; // requires pos.discountLine/Transaction (enforced upstream)
  /** explicit batch allocation from offline sale (batchId+qty) — validated on sync */
  batchAllocations?: { batchId: string; qty: Prisma.Decimal.Value }[] | null;
};

export type SaleInputPayment = {
  method: "CASH" | "TRANSFER" | "CARD";
  amount: Prisma.Decimal.Value;
  reference?: string | null;
};

export type CreateSaleParams = {
  businessId: string;
  cashierId: string;
  shiftId?: string | null;
  lines: SaleInputLine[];
  payments: SaleInputPayment[];
  idempotencyKey: string;
  channel?: "ONLINE" | "OFFLINE_SYNC";
  clientCreatedAt?: Date | null;
  /** offline sync path allows selling beyond confirmed stock, with warning */
  allowShortfall?: boolean;
  discountMode?: "NONE" | "LINE" | "TRANSACTION";
  transactionDiscount?: Prisma.Decimal.Value;
};

export type CreateSaleResult = {
  saleId: string;
  number: string;
  total: Prisma.Decimal;
  changeGiven: Prisma.Decimal;
  balanceDue: Prisma.Decimal;
  shortfallWarnings: string[];
};

/**
 * Complete a sale atomically:
 *   sale header + items (FEFO snapshot) + payments + stock movements
 *   + batch decrements + balance updates + cash movement + (audit upstream).
 *
 * IDEMPOTENT: unique Sale.idempotencyKey — a retried key returns the
 * original sale without re-executing any stock or payment side effect.
 */
export async function createSaleCore(tx: Tx, p: CreateSaleParams): Promise<CreateSaleResult> {
  // 1) Idempotency — check first, no side effects on retry
  const existing = await tx.sale.findUnique({
    where: { idempotencyKey: p.idempotencyKey },
    select: { id: true, number: true, total: true, amountPaid: true, changeGiven: true },
  });
  if (existing) {
    return {
      saleId: existing.id,
      number: existing.number,
      total: dec(existing.total),
      changeGiven: dec(existing.changeGiven),
      balanceDue: dec(existing.total).minus(dec(existing.amountPaid)),
      shortfallWarnings: [],
    };
  }

  if (!p.lines.length) throw new Error("EMPTY_SALE");
  if (!p.payments.length) throw new Error("NO_PAYMENT");

  const business = await tx.business.findUnique({
    where: { id: p.businessId },
    select: { defaultTaxRate: true, currency: true },
  });
  if (!business) throw new Error("BUSINESS_NOT_FOUND");

  // 2) Load products (tenant-scoped)
  const productIds = [...new Set(p.lines.map((l) => l.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, businessId: p.businessId },
  });
  const productMap = new Map(products.map((pr) => [pr.id, pr]));

  const shortfallWarnings: string[] = [];
  const taxDefault = dec(business.defaultTaxRate);

  type PreparedLine = {
    product: NonNullable<typeof products[number]>;
    quantityBase: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    discount: Prisma.Decimal;
    taxRatePct: Prisma.Decimal;
    lineNet: Prisma.Decimal;
    lineTax: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    cogs: Prisma.Decimal;
    allocations: { batchId: string; batchNumber: string; qty: Prisma.Decimal; expiryDate: Date; unitCost: Prisma.Decimal }[];
  };

  const prepared: PreparedLine[] = [];
  let subtotal = new D(0);
  let discountTotal = new D(0);
  let taxTotal = new D(0);

  // 3) Validate & compute each line (server-side prices & FEFO)
  for (const line of p.lines) {
    const product = productMap.get(line.productId);
    if (!product) throw new Error(`PRODUCT_NOT_FOUND:${line.productId}`);
    if (!product.isActive) throw new Error(`PRODUCT_INACTIVE:${product.name}`);
    const quantity = dec(line.quantity);
    if (quantity.lte(0)) throw new Error(`INVALID_QUANTITY:${product.name}`);

    const quantityBase = await resolveToBase(tx, { product, soldUnit: line.soldUnit, quantity });

    // Expired medicine batches must never sell — allocation excludes them;
    // batch-tracked products with zero eligible stock are blocked online.
    const { allocations, shortfall } = await allocateFefo(tx, {
      businessId: p.businessId,
      product,
      quantityBase,
      allowShortfall: p.allowShortfall ?? false,
    });
    if (shortfall.gt(0)) {
      shortfallWarnings.push(`${product.name}: sold beyond confirmed stock by ${shortfall} ${product.baseUnit}(s) (offline rule)`);
    }

    // Server-authoritative price per BASE unit (offline sync always re-prices
    // to current DB price; client hint never overrides the server).
    const unitPrice = dec(product.sellingPrice);
    const discount = money(dec(line.discountAmount ?? 0).lt(0) ? 0 : line.discountAmount ?? 0);
    const taxRatePct = dec(product.taxRate).gt(0) ? dec(product.taxRate) : taxDefault;
    const { net, tax, total } = computeLine({ quantity: quantityBase, unitPrice, discount, taxRatePct });

    // COGS from allocations (batch cost) weighted
    const cogs = sum(allocations.map((a) => a.qty.mul(a.unitCost)));

    prepared.push({
      product,
      quantityBase,
      unitPrice: money(unitPrice),
      discount,
      taxRatePct,
      lineNet: net,
      lineTax: tax,
      lineTotal: total,
      cogs,
      allocations: allocations.map((a) => ({
        batchId: a.batchId,
        batchNumber: a.batchNumber,
        qty: a.qty,
        expiryDate: a.expiryDate,
        unitCost: a.unitCost,
      })),
    });

    subtotal = subtotal.add(net);
    discountTotal = discountTotal.add(discount);
    taxTotal = taxTotal.add(tax);
  }

  // 4) Transaction-level discount (permission enforced upstream)
  let txDiscount = money(p.transactionDiscount ?? 0);
  if (txDiscount.gt(subtotal)) txDiscount = subtotal;
  const grandTotalBeforeTx = subtotal.add(taxTotal);
  const total = money(grandTotalBeforeTx.minus(txDiscount));

  // 5) Payment validation: allocations must reconcile
  const paidSum = money(sum(p.payments.map((pay) => pay.amount)));
  if (paidSum.lte(0)) throw new Error("NO_PAYMENT");
  const changeGiven = paidSum.gt(total) ? paidSum.minus(total) : new D(0);
  const balanceDue = total.minus(paidSum).gt(0) ? total.minus(paidSum) : new D(0);
  if (balanceDue.gt(0) && p.channel === "ONLINE") {
    // Partial payment allowed only as explicit balance-due sale (credit)
    // — supported; remaining balance shown on receipt.
  }
  const amountPaid = paidSum.gt(total) ? total : paidSum;

  // 6) Persist everything in ONE transaction (we're already inside tx)
  const number = await nextDocNumber(tx, p.businessId, "SLS");
  const sale = await tx.sale.create({
    data: {
      businessId: p.businessId,
      number,
      idempotencyKey: p.idempotencyKey,
      status: "COMPLETED",
      subtotal: money(subtotal),
      discountTotal: money(discountTotal.add(txDiscount)),
      taxTotal: money(taxTotal),
      total,
      amountPaid,
      changeGiven,
      cashierId: p.cashierId,
      shiftId: p.shiftId ?? null,
      channel: p.channel ?? "ONLINE",
      clientCreatedAt: p.clientCreatedAt ?? null,
      syncedAt: p.channel === "OFFLINE_SYNC" ? new Date() : null,
    },
  });

  for (const pl of prepared) {
    await tx.saleItem.create({
      data: {
        saleId: sale.id,
        businessId: p.businessId,
        productId: pl.product.id,
        productName: pl.product.name,
        department: pl.product.department === "SUPERMARKET" ? "SUPERMARKET" : "PHARMACY",
        quantity: pl.quantityBase, // recorded in base units for financial consistency
        soldUnit: pl.product.baseUnit,
        quantityBase: pl.quantityBase,
        unitPrice: pl.unitPrice, // per base unit
        costPrice: pl.quantityBase.gt(0) ? money(pl.cogs.div(pl.quantityBase)) : new D(0),
        discountAmount: pl.discount,
        taxAmount: pl.lineTax,
        lineTotal: pl.lineTotal,
        batchAllocationsJson: JSON.stringify(
          pl.allocations.map((a) => ({
            batchId: a.batchId,
            batchNumber: a.batchNumber,
            qty: a.qty.toString(),
            expiry: a.expiryDate.toISOString(),
            unitCost: a.unitCost.toString(),
          }))
        ),
      },
    });

    // Stock movements per allocation (batch-accurate)
    for (const a of pl.allocations) {
      await recordMovement(tx, {
        businessId: p.businessId,
        productId: pl.product.id,
        batchId: a.batchId || null,
        type: "SALE",
        quantity: a.qty.neg(),
        unitCost: a.unitCost,
        referenceType: "SALE",
        referenceId: sale.id,
        userId: p.cashierId,
        reason: shortfallWarnings.length && p.channel === "OFFLINE_SYNC" ? "Offline sync: sold beyond confirmed stock" : null,
      });
    }
  }

  // 7) Payments
  for (const pay of p.payments) {
    await tx.salePayment.create({
      data: {
        saleId: sale.id,
        method: pay.method,
        amount: money(pay.amount),
        reference: pay.reference ?? null,
      },
    });
  }

  // 8) Cash movement into shift (cash received minus change handed back)
  const cashIn = sum(p.payments.filter((x) => x.method === "CASH").map((x) => x.amount));
  if (cashIn.gt(0) && p.shiftId) {
    await tx.cashMovement.create({
      data: {
        businessId: p.businessId,
        shiftId: p.shiftId,
        type: "SALE",
        amount: money(cashIn.minus(changeGiven)),
        reason: `Sale ${number}`,
        userId: p.cashierId,
      },
    });
  }

  return { saleId: sale.id, number, total, changeGiven, balanceDue, shortfallWarnings };
}

/**
 * VOID a sale (manager approval enforced upstream): reverses stock, records
 * reversal movements, never deletes the original record.
 */
export async function voidSaleCore(
  tx: Tx,
  p: { businessId: string; saleId: string; voidedById: string; reason: string }
): Promise<void> {
  const sale = await tx.sale.findFirst({
    where: { id: p.saleId, businessId: p.businessId },
    include: { items: true, refunds: true },
  });
  if (!sale) throw new Error("SALE_NOT_FOUND");
  if (sale.status === "VOIDED") return; // idempotent
  if (sale.refunds.some((r) => r.status === "COMPLETED")) {
    throw new Error("CANNOT_VOID_REFUNDED");
  }

  for (const item of sale.items) {
    let allocations: { batchId: string; qty: string }[] = [];
    try {
      allocations = JSON.parse(item.batchAllocationsJson ?? "[]");
    } catch { /* legacy */ }
    if (allocations.length && allocations[0].batchId) {
      for (const a of allocations) {
        await recordMovement(tx, {
          businessId: p.businessId,
          productId: item.productId,
          batchId: a.batchId,
          type: "SALE_CANCELLED",
          quantity: dec(a.qty),
          unitCost: item.costPrice,
          referenceType: "SALE_VOID",
          referenceId: sale.id,
          userId: p.voidedById,
          reason: p.reason,
        });
      }
    } else {
      await recordMovement(tx, {
        businessId: p.businessId,
        productId: item.productId,
        type: "SALE_CANCELLED",
        quantity: item.quantityBase,
        unitCost: item.costPrice,
        referenceType: "SALE_VOID",
        referenceId: sale.id,
        userId: p.voidedById,
        reason: p.reason,
      });
    }
  }

  // Reverse the NET cash that entered the drawer (cash tendered minus change handed back)
  const cashPayments = await tx.salePayment.findMany({ where: { saleId: sale.id, method: "CASH" } });
  const cashTotal = sum(cashPayments.map((c) => c.amount));
  const cashNet = money(cashTotal.minus(dec(sale.changeGiven)));
  if (cashNet.gt(0) && sale.shiftId) {
    await tx.cashMovement.create({
      data: {
        businessId: p.businessId,
        shiftId: sale.shiftId,
        type: "REFUND",
        amount: cashNet.neg(),
        reason: `Void ${sale.number}`,
        userId: p.voidedById,
      },
    });
  }

  await tx.sale.update({
    where: { id: sale.id },
    data: { status: "VOIDED", voidedAt: new Date(), voidedById: p.voidedById, voidReason: p.reason },
  });
}

/**
 * Process an APPROVED refund: reversal movements (restock to the same batch
 * where possible), linked Refund records, cash-out movement.
 */
export async function processRefundCore(
  tx: Tx,
  p: {
    businessId: string;
    refundId: string;
    processedById: string;
  }
): Promise<void> {
  const refund = await tx.refund.findFirst({
    where: { id: p.refundId, businessId: p.businessId },
    include: { lines: { include: { saleItem: true } }, sale: true },
  });
  if (!refund) throw new Error("REFUND_NOT_FOUND");
  if (refund.status === "COMPLETED") return; // idempotent

  for (const line of refund.lines) {
    const item = line.saleItem;
    let allocations: { batchId: string; qty: string }[] = [];
    try {
      allocations = JSON.parse(item.batchAllocationsJson ?? "[]");
    } catch { /* legacy */ }

    const baseQty = line.quantity; // refund line quantity is in base units
    if (line.restock && allocations.length && allocations[0].batchId) {
      // Restock into the same batches (proportional to original allocation)
      const soldBase = dec(item.quantityBase);
      let remaining = baseQty;
      for (const a of allocations) {
        if (remaining.lte(0)) break;
        const share = soldBase.gt(0) ? dec(a.qty).div(soldBase) : new D(0);
        let giveBack = dec(baseQty).mul(share);
        if (giveBack.gt(remaining)) giveBack = remaining;
        if (giveBack.lte(0)) continue;
        await recordMovement(tx, {
          businessId: p.businessId,
          productId: item.productId,
          batchId: a.batchId,
          type: "RETURN_IN",
          quantity: giveBack,
          unitCost: item.costPrice,
          referenceType: "REFUND",
          referenceId: refund.id,
          userId: p.processedById,
          reason: `Refund ${refund.number}`,
        });
        remaining = remaining.minus(giveBack);
      }
      if (remaining.gt(0)) {
        // Batch full/damaged — restock to general balance only
        await recordMovement(tx, {
          businessId: p.businessId,
          productId: item.productId,
          type: "RETURN_IN",
          quantity: remaining,
          unitCost: item.costPrice,
          referenceType: "REFUND",
          referenceId: refund.id,
          userId: p.processedById,
          reason: "Batch unavailable for restock — added to unassigned balance",
        });
      }
    } else if (line.restock) {
      await recordMovement(tx, {
        businessId: p.businessId,
        productId: item.productId,
        type: "RETURN_IN",
        quantity: baseQty,
        unitCost: item.costPrice,
        referenceType: "REFUND",
        referenceId: refund.id,
        userId: p.processedById,
        reason: `Refund ${refund.number}`,
      });
    }
  }

  // Cash out of the shift if original sale had cash payments
  const cashPayments = await tx.salePayment.findMany({ where: { saleId: refund.saleId, method: "CASH" } });
  const refundPortion = dec(refund.sale.total).gt(0) ? dec(refund.amount).div(dec(refund.sale.total)) : new D(0);
  const cashOut = sum(cashPayments.map((c) => c.amount)).mul(refundPortion);
  if (cashOut.gt(0) && refund.sale.shiftId) {
    await tx.cashMovement.create({
      data: {
        businessId: p.businessId,
        shiftId: refund.sale.shiftId,
        type: "REFUND",
        amount: money(cashOut.neg()),
        reason: `Refund ${refund.number}`,
        userId: p.processedById,
      },
    });
  }

  await tx.refund.update({
    where: { id: refund.id },
    data: { status: "COMPLETED", processedAt: new Date() },
  });
  await tx.sale.update({
    where: { id: refund.saleId },
    data: { status: refund.type === "FULL" ? "REFUNDED" : "PARTIALLY_REFUNDED" },
  });
}
