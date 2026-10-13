import { Prisma } from "@prisma/client";
import { dec, money } from "@/lib/money";
import { recordMovement } from "@/server/inventory/stock-service";
import { nextDocNumber } from "@/lib/serial";

type Tx = Prisma.TransactionClient;

export type ReceiveLine = {
  productId: string;
  quantity: Prisma.Decimal.Value; // base units
  unitCost: Prisma.Decimal.Value;
  batchNumber?: string | null; // required for MEDICINE products
  expiryDate?: Date | null; // required for MEDICINE products
};

export type ReceiveParams = {
  businessId: string;
  supplierId: string;
  poId?: string | null;
  lines: ReceiveLine[];
  receivedById: string;
  notes?: string | null;
  number?: string | null; // seeder may pin a number
  /** update supplier payable balance (credit purchases) */
  onCredit?: boolean;
};

/**
 * Receive goods atomically:
 *  - validates lines & products (tenant-scoped; medicines require batch+expiry)
 *  - creates/updates PharmacyBatch rows for batch-tracked products
 *  - appends PURCHASE_RECEIPT movements + updates cached balances
 *  - updates PO line receivedQty + PO status (PARTIALLY_RECEIVED/RECEIVED)
 *  - increases supplier payable balance when on credit
 */
export async function receiveGoodsCore(tx: Tx, p: ReceiveParams): Promise<{ receiptId: string; number: string }> {
  if (!p.lines.length) throw new Error("EMPTY_RECEIPT");

  const productIds = [...new Set(p.lines.map((l) => l.productId))];
  const products = await tx.product.findMany({ where: { id: { in: productIds }, businessId: p.businessId } });
  const productMap = new Map(products.map((pr) => [pr.id, pr]));

  // Validate
  for (const line of p.lines) {
    const product = productMap.get(line.productId);
    if (!product) throw new Error(`PRODUCT_NOT_FOUND:${line.productId}`);
    if (dec(line.quantity).lte(0)) throw new Error(`INVALID_QTY:${product.name}`);
    if (product.trackBatches) {
      if (!line.batchNumber?.trim()) throw new Error(`BATCH_REQUIRED:${product.name}`);
      if (!line.expiryDate) throw new Error(`EXPIRY_REQUIRED:${product.name}`);
      if (line.expiryDate.getTime() < Date.now()) throw new Error(`EXPIRED_BATCH_REJECTED:${product.name}`);
    }
  }

  const number = p.number ?? (await nextDocNumber(tx, p.businessId, "GRN"));
  const totalCost = money(
    p.lines.reduce((acc, l) => acc.add(dec(l.quantity).mul(dec(l.unitCost))), new Prisma.Decimal(0))
  );

  const receipt = await tx.goodsReceipt.create({
    data: {
      businessId: p.businessId,
      poId: p.poId ?? null,
      supplierId: p.supplierId,
      number,
      receivedById: p.receivedById,
      notes: p.notes ?? null,
      totalCost,
    },
  });

  for (const line of p.lines) {
    const product = productMap.get(line.productId)!;
    await tx.goodsReceiptLine.create({
      data: {
        receiptId: receipt.id,
        productId: product.id,
        quantity: dec(line.quantity),
        unitCost: dec(line.unitCost),
        batchNumber: line.batchNumber ?? null,
        expiryDate: line.expiryDate ?? null,
      },
    });

    let batchId: string | null = null;
    if (product.trackBatches) {
      const existing = await tx.pharmacyBatch.findFirst({
        where: { businessId: p.businessId, productId: product.id, batchNumber: line.batchNumber!.trim() },
      });
      if (existing) {
        batchId = existing.id;
        await tx.pharmacyBatch.update({
          where: { id: existing.id },
          data: {
            quantityReceived: { increment: dec(line.quantity) },
            // quantityRemaining is updated ONLY by recordMovement (ledger)
            unitCost: dec(line.unitCost), // latest cost wins for same batch no.
            status: existing.status === "DEPLETED" ? "ACTIVE" : existing.status,
          },
        });
      } else {
        const batch = await tx.pharmacyBatch.create({
          data: {
            businessId: p.businessId,
            productId: product.id,
            supplierId: p.supplierId,
            goodsReceiptId: receipt.id,
            batchNumber: line.batchNumber!.trim(),
            expiryDate: line.expiryDate!,
            quantityReceived: dec(line.quantity),
            quantityRemaining: new Prisma.Decimal(0), // movement ledger adds it
            unitCost: dec(line.unitCost),
            status: "ACTIVE",
          },
        });
        batchId = batch.id;
      }
    }

    // Movement (stock in)
    await recordMovement(tx, {
      businessId: p.businessId,
      productId: product.id,
      batchId,
      type: "PURCHASE_RECEIPT",
      quantity: dec(line.quantity),
      unitCost: dec(line.unitCost),
      referenceType: "GOODS_RECEIPT",
      referenceId: receipt.id,
      userId: p.receivedById,
      reason: `Goods receipt ${number}`,
    });

    // Update product cost price to latest cost (purchase price history via movements)
    await tx.product.update({
      where: { id: product.id },
      data: { costPrice: dec(line.unitCost) },
    });

    // Update supplier-product link last cost
    await tx.supplierProduct.upsert({
      where: { supplierId_productId: { supplierId: p.supplierId, productId: product.id } },
      create: { supplierId: p.supplierId, productId: product.id, lastCost: dec(line.unitCost) },
      update: { lastCost: dec(line.unitCost) },
    });

    // PO line progress
    if (p.poId) {
      const poLine = await tx.purchaseOrderLine.findFirst({
        where: { poId: p.poId, productId: product.id },
      });
      if (poLine) {
        await tx.purchaseOrderLine.update({
          where: { id: poLine.id },
          data: { receivedQty: { increment: dec(line.quantity) } },
        });
      }
    }
  }

  // Supplier payable (credit purchase)
  if (p.onCredit) {
    await tx.supplier.update({
      where: { id: p.supplierId },
      data: { balance: { increment: totalCost } },
    });
  }

  // PO status update
  if (p.poId) {
    const poLines = await tx.purchaseOrderLine.findMany({ where: { poId: p.poId } });
    const fullyReceived = poLines.every((l) => dec(l.receivedQty).gte(dec(l.quantity)));
    const anyReceived = poLines.some((l) => dec(l.receivedQty).gt(0));
    await tx.purchaseOrder.update({
      where: { id: p.poId },
      data: { status: fullyReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : "ORDERED" },
    });
  }

  return { receiptId: receipt.id, number };
}
