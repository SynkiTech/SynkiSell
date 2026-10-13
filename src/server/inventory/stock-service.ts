import { Prisma, type PharmacyBatch, type Product } from "@prisma/client";
import { dec, qty as q4 } from "@/lib/money";

type Tx = Prisma.TransactionClient;

/**
 * Stock ledger — the ONLY way stock changes. Every movement is appended and
 * the cached StockBalance projection is updated inside the same transaction,
 * keeping the balance reconcilable against SUM(movements).
 */
export async function recordMovement(
  tx: Tx,
  input: {
    businessId: string;
    productId: string;
    batchId?: string | null;
    type:
      | "PURCHASE_RECEIPT" | "SALE" | "SALE_CANCELLED" | "RETURN_IN" | "RETURN_OUT"
      | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "DAMAGE" | "SUPPLIER_RETURN" | "OPENING";
    quantity: Prisma.Decimal.Value; // signed; negative = stock out
    unitCost?: Prisma.Decimal.Value;
    reason?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  const quantity = q4(input.quantity);
  await tx.stockMovement.create({
    data: {
      businessId: input.businessId,
      productId: input.productId,
      batchId: input.batchId ?? null,
      type: input.type,
      quantity,
      unitCost: dec(input.unitCost ?? 0),
      reason: input.reason ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      userId: input.userId ?? null,
    },
  });
  // Update cached balance (projection)
  await tx.stockBalance.upsert({
    where: { productId: input.productId },
    create: { businessId: input.businessId, productId: input.productId, quantity },
    update: { quantity: { increment: quantity } },
  });
  // Update batch remaining quantity when batch-scoped (negative movement = out)
  if (input.batchId) {
    await tx.pharmacyBatch.update({
      where: { id: input.batchId },
      data: { quantityRemaining: { increment: quantity } },
    });
  }
}

/**
 * Expire-mark batches whose expiry date has passed. Idempotent; called by
 * queries that list batches and before allocation.
 */
export async function expireMarkBatches(tx: Tx, businessId: string): Promise<void> {
  await tx.pharmacyBatch.updateMany({
    where: {
      businessId,
      status: "ACTIVE",
      expiryDate: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
}

export type FefoAllocation = {
  batchId: string;
  batchNumber: string;
  expiryDate: Date;
  qty: Prisma.Decimal; // base units
  unitCost: Prisma.Decimal;
};

/**
 * FEFO allocation — first-EXPIRY-first-out across ACTIVE, non-expired,
 * non-quarantined batches with remaining stock. Throws INSUFFICIENT_STOCK
 * unless allowShortfall (offline sync path records the warning instead).
 */
export async function allocateFefo(
  tx: Tx,
  input: {
    businessId: string;
    product: Product;
    quantityBase: Prisma.Decimal.Value;
    allowShortfall?: boolean;
  }
): Promise<{ allocations: FefoAllocation[]; shortfall: Prisma.Decimal }> {
  const need = dec(input.quantityBase);

  if (!input.product.trackBatches) {
    const balance = await tx.stockBalance.findUnique({ where: { productId: input.product.id } });
    const available = dec(balance?.quantity ?? 0);
    if (available.lt(need) && !input.allowShortfall) {
      throw new Error(`INSUFFICIENT_STOCK:${input.product.name}`);
    }
    return {
      allocations: [
        {
          batchId: "",
          batchNumber: "—",
          expiryDate: new Date(0),
          qty: need,
          unitCost: dec(input.product.costPrice),
        },
      ],
      shortfall: available.lt(need) ? need.minus(available) : new Prisma.Decimal(0),
    };
  }

  await expireMarkBatches(tx, input.businessId);
  const batches = await tx.pharmacyBatch.findMany({
    where: { businessId: input.businessId, productId: input.product.id, status: "ACTIVE", quantityRemaining: { gt: 0 } },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
  });

  let remaining = need;
  const allocations: FefoAllocation[] = [];
  for (const b of batches) {
    if (remaining.lte(0)) break;
    const take = dec(b.quantityRemaining).gte(remaining) ? remaining : dec(b.quantityRemaining);
    if (take.lte(0)) continue;
    allocations.push({
      batchId: b.id,
      batchNumber: b.batchNumber,
      expiryDate: b.expiryDate,
      qty: q4(take),
      unitCost: dec(b.unitCost),
    });
    remaining = remaining.minus(take);
  }
  const shortfall = remaining.gt(0) ? remaining : new Prisma.Decimal(0);
  if (shortfall.gt(0) && !input.allowShortfall) {
    throw new Error(`INSUFFICIENT_STOCK:${input.product.name}`);
  }
  return { allocations, shortfall };
}

/** Resolve a sold unit (e.g. carton) to base units via configured conversions. */
export async function resolveToBase(
  tx: Tx,
  input: { product: Product; soldUnit: string; quantity: Prisma.Decimal.Value }
): Promise<Prisma.Decimal> {
  const quantity = dec(input.quantity);
  if (input.soldUnit === input.product.baseUnit) return q4(quantity);
  if (input.soldUnit === "unit") return q4(quantity); // alias of base
  const conv = await tx.unitConversion.findUnique({
    where: {
      productId_fromUnit_toUnit: {
        productId: input.product.id,
        fromUnit: input.soldUnit,
        toUnit: input.product.baseUnit,
      },
    },
  });
  if (!conv) {
    throw new Error(`INVALID_UNIT:${input.product.name}:${input.soldUnit}`);
  }
  return q4(quantity.mul(dec(conv.factor)));
}

/** Recompute a product's cached balance from the ledger (repair routine). */
export async function recomputeBalance(tx: Tx, businessId: string, productId: string): Promise<Prisma.Decimal> {
  const agg = await tx.stockMovement.aggregate({
    where: { businessId, productId },
    _sum: { quantity: true },
  });
  const total = dec(agg._sum.quantity ?? 0);
  await tx.stockBalance.upsert({
    where: { productId },
    create: { businessId, productId, quantity: total },
    update: { quantity: total },
  });
  return total;
}

export type BatchRow = PharmacyBatch;
