import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dec, money } from "@/lib/money";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

const D = Prisma.Decimal;

/**
 * Apply a VERIFIED payment to its invoice — the ONLY path that flips
 * invoice/subscription state. Idempotent: repeated calls for the same
 * reference are no-ops.
 */
export async function applyVerifiedPayment(reference: string, via: "VERIFY_API" | "PAYSTACK_WEBHOOK" | "MOCK_CONFIRM" | "ADMIN_MANUAL"): Promise<{ applied: boolean; invoiceNumber?: string }> {
  const payment = await db.paymentTransaction.findUnique({ where: { reference } });
  if (!payment) throw new Error("Unknown payment reference.");
  if (payment.status === "SUCCESS") return { applied: false }; // idempotent

  if (!payment.invoiceId) throw new Error("Payment is not linked to an invoice.");
  const invoice = await db.invoice.findUnique({ where: { id: payment.invoiceId }, include: { lines: true, business: { select: { name: true } } } });
  if (!invoice) throw new Error("Invoice not found.");

  // Guard: verified amount must cover the invoice
  if (dec(payment.amount).lt(dec(invoice.total))) {
    throw new Error(`Verified amount (₦${payment.amount}) is less than invoice total (₦${invoice.total}). Payment not applied.`);
  }

  await db.$transaction(async (tx) => {
    await tx.paymentTransaction.update({
      where: { reference },
      data: {
        status: "SUCCESS",
        verifiedAt: new Date(),
        purpose: invoice.kind === "DEPLOYMENT" ? "DEPLOYMENT" : invoice.kind === "SUBSCRIPTION" ? "SUBSCRIPTION" : "CUSTOM",
        channelJson: JSON.stringify({ via, verifiedAt: new Date().toISOString() }),
      },
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID", paidAt: new Date() } });

    // Deployment order advance on deployment payment
    const deploymentLine = invoice.lines.find((l) => l.kind === "DEPLOYMENT");
    const subscriptionLine = invoice.lines.find((l) => l.kind === "SUBSCRIPTION");
    const now = new Date();

    const deployment = await tx.deploymentOrder.findUnique({ where: { businessId: invoice.businessId } });
    if (deploymentLine && deployment && ["AWAITING_PAYMENT", "PAYMENT_CONFIRMED"].includes(deployment.stage)) {
      await tx.deploymentOrder.update({
        where: { id: deployment.id },
        data: { stage: "AWAITING_SETUP", notes: `Deployment fee paid (ref ${reference} via ${via}). Awaiting setup by platform team.` },
      });
    }

    const subscription = await tx.subscription.findUnique({ where: { businessId: invoice.businessId } });
    if (subscriptionLine && subscription) {
      const start = subscription.startDate && subscription.status === "ACTIVE" ? subscription.endDate ?? now : now;
      const end = new Date(start.getTime() + 365 * 864e5);
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: "ACTIVE",
          startDate: start,
          endDate: end,
          graceEndDate: new Date(end.getTime() + 7 * 864e5),
        },
      });
    }

    // Restore operational access for a previously suspended/expired business
    await tx.business.update({ where: { id: invoice.businessId }, data: { status: "ACTIVE" } });
  });

  await audit({
    businessId: payment.businessId,
    actorLabel: `system:${via}`,
    action: AUDIT_ACTIONS.PAYMENT_VERIFIED,
    entityType: "PaymentTransaction",
    entityId: payment.id,
    meta: { reference, amount: payment.amount.toString(), invoice: invoice.number },
  });

  return { applied: true, invoiceNumber: invoice.number };
}

/** Generate renewal reminder records at 30/14/7/1 days before expiry (idempotent). */
export async function generateRenewalReminders(): Promise<number> {
  const subs = await db.subscription.findMany({
    where: { status: "ACTIVE", endDate: { not: null } },
    include: { plan: { select: { name: true } }, business: { select: { name: true } } },
  });
  let created = 0;
  for (const sub of subs) {
    if (!sub.endDate) continue;
    const daysLeft = Math.ceil((sub.endDate.getTime() - Date.now()) / 864e5);
    if (![30, 14, 7, 1].includes(daysLeft)) continue;
    const recent = await db.notification.findFirst({
      where: {
        businessId: sub.businessId,
        type: "RENEWAL",
        createdAt: { gte: new Date(Date.now() - 2 * 864e5) },
        body: { contains: `${daysLeft} day` },
      },
    });
    if (recent) continue;
    await db.notification.create({
      data: {
        businessId: sub.businessId,
        type: "RENEWAL",
        title: `Subscription renews in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`,
        body: `Your ${sub.plan?.name ?? "Standard"} plan renews on ${sub.endDate.toISOString().slice(0, 10)}. Renew from Billing to avoid service interruption.`,
        severity: daysLeft <= 7 ? "WARNING" : "INFO",
        linkJson: JSON.stringify({ view: "billing" }),
      },
    });
    await db.subscription.update({ where: { id: sub.id }, data: { lastReminderAt: new Date() } });
    created++;
  }

  // Grace / expiry transitions
  const due = await db.subscription.findMany({
    where: { status: { in: ["ACTIVE", "PAST_DUE", "GRACE"] }, endDate: { lt: new Date() } },
  });
  for (const sub of due) {
    const graceEnd = sub.graceEndDate ?? new Date((sub.endDate ?? new Date()).getTime() + 7 * 864e5);
    if (Date.now() < graceEnd.getTime()) {
      if (sub.status !== "GRACE") {
        await db.subscription.update({ where: { id: sub.id }, data: { status: "GRACE" } });
        await db.notification.create({
          data: {
            businessId: sub.businessId,
            type: "RENEWAL",
            title: "Subscription in grace period",
            body: "Your subscription has expired. You have a short grace period to renew before operational access is restricted. Your data is safe.",
            severity: "WARNING",
          },
        });
        created++;
      }
    } else {
      if (sub.status !== "EXPIRED") {
        await db.subscription.update({ where: { id: sub.id }, data: { status: "EXPIRED" } });
        await db.business.update({ where: { id: sub.businessId }, data: { status: "SUSPENDED" } });
        await db.notification.create({
          data: {
            businessId: sub.businessId,
            type: "RENEWAL",
            title: "Subscription expired",
            body: "Operational access is now restricted. Billing and data export remain available — renew to restore access. Your data is never deleted.",
            severity: "CRITICAL",
            linkJson: JSON.stringify({ view: "billing" }),
          },
        });
        created++;
      }
    }
  }
  return created;
}
