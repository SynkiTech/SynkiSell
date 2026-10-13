import { db } from "@/lib/db";

/**
 * Sequential document numbers per business: SLS-000001, RFD-000001,
 * PO-000001, GRN-000001, INV-000001.
 * Called inside the same transaction as the creating operation.
 */
type Tx = { [key: string]: any }; // Prisma transaction client (structural)

export async function nextDocNumber(tx: Tx, businessId: string, prefix: "SLS" | "RFD" | "PO" | "GRN" | "INV" | "DPO"): Promise<string> {
  const table =
    prefix === "SLS" ? tx.sale : prefix === "RFD" ? tx.refund : prefix === "PO" ? tx.purchaseOrder : prefix === "GRN" ? tx.goodsReceipt : tx.invoice;
  const last = await table.findFirst({
    where: { businessId, number: { startsWith: `${prefix}-` } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = last ? parseInt(last.number.split("-")[1] ?? "0", 10) : 0;
  const next = (isNaN(lastSeq) ? 0 : lastSeq) + 1;
  return `${prefix}-${String(next).padStart(6, "0")}`;
}
