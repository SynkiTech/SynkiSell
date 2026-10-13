"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requirePermission } from "@/lib/guards";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { dec, money } from "@/lib/money";
import { paystackInitialize, paystackVerify, paystackMode, paystackConfigured } from "@/server/billing/paystack";
import { applyVerifiedPayment } from "@/server/billing/apply-payment";

export async function getBillingOverview(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "billing.view");
    const [subscription, deployment, invoices, payments, pricingSetting, notifications] = await Promise.all([
      db.subscription.findUnique({ where: { businessId: ctx.businessId }, include: { plan: true } }),
      db.deploymentOrder.findUnique({ where: { businessId: ctx.businessId } }),
      db.invoice.findMany({ where: { businessId: ctx.businessId }, include: { lines: true, payments: true }, orderBy: { createdAt: "desc" } }),
      db.paymentTransaction.findMany({ where: { businessId: ctx.businessId }, orderBy: { createdAt: "desc" }, take: 20 }),
      db.platformSetting.findUnique({ where: { key: "pricing" } }),
      db.notification.findMany({ where: { businessId: ctx.businessId, type: "RENEWAL" }, orderBy: { createdAt: "desc" }, take: 5 }),
    ]);

    const daysLeft = subscription?.endDate ? Math.ceil((subscription.endDate.getTime() - Date.now()) / 864e5) : null;

    return {
      mode: paystackMode(),
      subscription: subscription
        ? {
            status: subscription.status,
            plan: subscription.plan.name,
            annualFee: subscription.plan.annualFee,
            startDate: subscription.startDate?.toISOString() ?? null,
            endDate: subscription.endDate?.toISOString() ?? null,
            graceEndDate: subscription.graceEndDate?.toISOString() ?? null,
            autoRenew: subscription.autoRenew,
            daysLeft,
          }
        : null,
      deployment: deployment
        ? { stage: deployment.stage, feeAmount: deployment.feeAmount, completedAt: deployment.completedAt?.toISOString() ?? null }
        : null,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        kind: inv.kind,
        status: inv.status,
        total: inv.total,
        issuedAt: inv.issuedAt?.toISOString() ?? null,
        paidAt: inv.paidAt?.toISOString() ?? null,
        lines: inv.lines.map((l) => ({ kind: l.kind, description: l.description, amount: l.amount })),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        reference: p.reference,
        method: p.method,
        amount: p.amount,
        status: p.status,
        provider: p.provider,
        createdAt: p.createdAt.toISOString(),
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
      })),
      pricing: pricingSetting ? JSON.parse(pricingSetting.valueJson) : null,
      reminders: notifications.map((n) => ({ title: n.title, body: n.body, severity: n.severity, createdAt: n.createdAt.toISOString() })),
    };
  });
}

/** Start payment for the current outstanding invoice (deployment/subscription). */
export async function startInvoicePayment(businessId: string, invoiceId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "billing.view");
    const invoice = await db.invoice.findFirst({
      where: { id: invoiceId, businessId: ctx.businessId, status: { in: ["DRAFT", "ISSUED"] } },
      include: { lines: true },
    });
    if (!invoice) throw new Error("Invoice not found or already paid.");

    const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });
    const result = await paystackInitialize({
      businessId: ctx.businessId,
      invoiceId: invoice.id,
      email: user?.email ?? "owner@example.com",
      amountKobo: Math.round(Number(invoice.total) * 100),
      metadata: { invoiceNumber: invoice.number, businessName: ctx.businessName },
    });

    return {
      ok: true,
      mode: result.mode,
      reference: result.reference,
      authorizationUrl: result.authorizationUrl,
      amount: invoice.total.toString(),
      invoiceNumber: invoice.number,
    };
  });
}

/**
 * MOCK TEST MODE confirm — simulates a provider-side successful charge so the
 * full verify→apply pipeline can be exercised without real keys.
 * The operation is labelled MOCK everywhere; it never runs when real keys
 * are configured.
 */
export async function mockConfirmPayment(businessId: string, reference: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "billing.view");
    if (paystackConfigured()) {
      throw new Error("Mock confirmation is disabled because real Paystack keys are configured.");
    }
    const payment = await db.paymentTransaction.findUnique({ where: { reference } });
    if (!payment || payment.businessId !== ctx.businessId) throw new Error("Unknown payment reference.");

    // Mock mode: applyVerifiedPayment owns the status transition — the
    // verify endpoint result is not trusted for state changes.
    const verification = await paystackVerify(reference);
    const applied = await applyVerifiedPayment(reference, "MOCK_CONFIRM");
    return { ok: true, mode: "MOCK_TEST_MODE", applied, invoiceNumber: applied.invoiceNumber };
  });
}

/** Poll a payment reference (UI polling after redirect). Verifies server-side. */
export async function checkPaymentStatus(businessId: string, reference: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "billing.view");
    const payment = await db.paymentTransaction.findUnique({ where: { reference } });
    if (!payment || payment.businessId !== ctx.businessId) throw new Error("Unknown payment reference.");
    if (payment.status === "SUCCESS") return { status: "SUCCESS", invoiceNumber: (await db.invoice.findUnique({ where: { id: payment.invoiceId! } }))?.number };
    const verification = await paystackVerify(reference);
    if (verification.status === "SUCCESS") {
      const applied = await applyVerifiedPayment(reference, "VERIFY_API");
      return { status: "SUCCESS", invoiceNumber: applied.invoiceNumber };
    }
    return { status: verification.status, invoiceNumber: null };
  });
}
