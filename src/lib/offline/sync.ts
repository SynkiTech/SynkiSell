"use client";

import { listQueuedSales, updateQueuedSale, type QueuedSale } from "./db";

/**
 * Sync worker — replays the offline queue oldest-first.
 * The server enforces idempotency (Sale.idempotencyKey unique), so retries
 * never double-deduct stock. Each sale moves to synced/failed explicitly;
 * nothing is discarded silently.
 */
export async function syncOfflineSales(
  businessId: string,
  onProgress?: (state: { synced: number; failed: number; remaining: number }) => void
): Promise<{ synced: number; failed: number; remaining: number }> {
  const { syncOfflineSale } = await import("@/server/actions/pos-actions");
  const queue = await listQueuedSales(businessId);
  const pending = queue.filter((q) => q.status === "pending" || (q.status === "failed" && q.attempts < 5));

  let synced = 0;
  let failed = 0;
  let remaining = pending.length;

  for (const sale of pending) {
    try {
      const result = await syncOfflineSale({
        businessId: sale.businessId,
        shiftId: sale.shiftId,
        lines: sale.lines,
        payments: sale.payments,
        transactionDiscount: sale.transactionDiscount,
        idempotencyKey: sale.idempotencyKey,
        clientCreatedAt: sale.clientCreatedAt,
      });
      if (result?.ok) {
        await updateQueuedSale({ ...sale, status: "synced", serverNumber: result.number, error: undefined });
        synced++;
      } else {
        throw new Error("sync rejected");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown sync error";
      // Permission/validation errors are permanent; network/5xx retried later
      const permanent = message.includes("PERMISSION_DENIED") || message.includes("INVALID_UNIT") || message.includes("BUSINESS_SUSPENDED");
      await updateQueuedSale({
        ...sale,
        status: permanent || sale.attempts >= 4 ? "failed" : "pending",
        attempts: sale.attempts + 1,
        error: message.slice(0, 200),
      });
      if (permanent || sale.attempts >= 4) failed++;
    }
    remaining--;
    onProgress?.({ synced, failed, remaining });
  }

  const { pendingCount } = await import("./db");
  const left = await pendingCount(businessId);
  return { synced, failed, remaining: left };
}
