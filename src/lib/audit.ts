import { db } from "@/lib/db";

/**
 * Append-only audit logging. There is deliberately NO update/delete path
 * for audit events in the application — users cannot rewrite history.
 */
export async function audit(input: {
  businessId?: string | null;
  actorId?: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        businessId: input.businessId ?? null,
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        reason: input.reason ?? null,
        metaJson: input.meta ? JSON.stringify(input.meta) : null,
      },
    });
  } catch (err) {
    // Auditing must never break the business operation, but failures are loud.
    console.error("[audit-failure]", input.action, err instanceof Error ? err.message : err);
  }
}

export const AUDIT_ACTIONS = {
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  BUSINESS_REGISTERED: "BUSINESS_REGISTERED",
  ONBOARDING_COMPLETED: "ONBOARDING_COMPLETED",
  PRODUCT_CREATED: "PRODUCT_CREATED",
  PRODUCT_UPDATED: "PRODUCT_UPDATED",
  PRICE_CHANGE: "PRICE_CHANGE",
  PRODUCT_IMPORTED: "PRODUCT_IMPORTED",
  STOCK_ADJUSTMENT: "STOCK_ADJUSTMENT",
  GOODS_RECEIVED: "GOODS_RECEIVED",
  PO_CREATED: "PO_CREATED",
  SUPPLIER_SAVED: "SUPPLIER_SAVED",
  SALE_COMPLETED: "SALE_COMPLETED",
  SALE_REPRINTED: "SALE_REPRINTED",
  SALE_VOIDED: "SALE_VOIDED",
  REFUND_REQUESTED: "REFUND_REQUESTED",
  REFUND_APPROVED: "REFUND_APPROVED",
  REFUND_REJECTED: "REFUND_REJECTED",
  REFUND_COMPLETED: "REFUND_COMPLETED",
  SHIFT_OPENED: "SHIFT_OPENED",
  SHIFT_CLOSED: "SHIFT_CLOSED",
  EXPENSE_RECORDED: "EXPENSE_RECORDED",
  EXPENSE_APPROVED: "EXPENSE_APPROVED",
  STAFF_INVITED: "STAFF_INVITED",
  STAFF_UPDATED: "STAFF_UPDATED",
  STAFF_DEACTIVATED: "STAFF_DEACTIVATED",
  SETTINGS_CHANGED: "SETTINGS_CHANGED",
  SUBSCRIPTION_CHANGE: "SUBSCRIPTION_CHANGE",
  PLAN_CHANGE: "PLAN_CHANGE",
  DEPLOYMENT_STAGE_CHANGE: "DEPLOYMENT_STAGE_CHANGE",
  INVOICE_ISSUED: "INVOICE_ISSUED",
  PAYMENT_VERIFIED: "PAYMENT_VERIFIED",
  EXPORT_DATA: "EXPORT_DATA",
  AI_ADMIN_CHANGE: "AI_ADMIN_CHANGE",
} as const;
