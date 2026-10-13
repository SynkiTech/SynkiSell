"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requirePlatformAdmin } from "@/lib/guards";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { dec, money } from "@/lib/money";
import { applyVerifiedPayment, generateRenewalReminders } from "@/server/billing/apply-payment";
import { paystackMode } from "@/server/billing/paystack";
import { nextDocNumber } from "@/lib/serial";
import type { Prisma } from "@prisma/client";

/* ─────────────────── Platform admin: overview ─────────────────── */

export async function getPlatformOverview() {
  return guarded(async () => {
    await requirePlatformAdmin();
    const [businessCount, activeSubs, pendingDeployments, revenueAgg, recentBusinesses, openInvoices, announcements, aiUsageMonth] = await Promise.all([
      db.business.count(),
      db.subscription.count({ where: { status: "ACTIVE" } }),
      db.deploymentOrder.findMany({ where: { stage: { notIn: ["LIVE"] } }, include: { business: { select: { name: true, state: true } } }, orderBy: { updatedAt: "desc" } }),
      db.paymentTransaction.aggregate({ where: { status: "SUCCESS" }, _sum: { amount: true } }),
      db.business.findMany({ include: { subscription: { include: { plan: { select: { name: true } } } }, _count: { select: { memberships: { where: { isActive: true } } } } }, orderBy: { createdAt: "desc" }, take: 12 }),
      db.invoice.findMany({ where: { status: { in: ["DRAFT", "ISSUED"] } }, include: { business: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 12 }),
      db.announcement.findMany({ where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 5 }),
      db.aiUsage.aggregate({ where: { createdAt: { gte: new Date(Date.now() - 30 * 864e5) } }, _count: true }),
    ]);
    return {
      mode: paystackMode(),
      metrics: {
        businesses: businessCount,
        activeSubscriptions: activeSubs,
        collectedRevenue: money(revenueAgg._sum.amount ?? 0),
        aiCalls30d: aiUsageMonth._count,
      },
      pendingDeployments: pendingDeployments.map((d) => ({ id: d.id, business: d.business.name, state: d.business.state, stage: d.stage, updatedAt: d.updatedAt.toISOString() })),
      recentBusinesses: recentBusinesses.map((b) => ({
        id: b.id, name: b.name, state: b.state, businessType: b.businessType,
        status: b.status, createdAt: b.createdAt.toISOString(),
        subscription: b.subscription ? { status: b.subscription.status, plan: b.subscription.plan?.name ?? "—", endDate: b.subscription.endDate?.toISOString() ?? null } : null,
        staffCount: b._count.memberships,
      })),
      openInvoices: openInvoices.map((i) => ({ id: i.id, number: i.number, businessId: i.businessId, business: i.business.name, total: i.total, status: i.status, issuedAt: i.issuedAt?.toISOString() ?? null })),
      announcements: announcements.map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: a.createdAt.toISOString() })),
    };
  });
}

/* ─────────────────── Platform admin: businesses ─────────────────── */

export async function adminListBusinesses(search?: string) {
  return guarded(async () => {
    await requirePlatformAdmin();
    return db.business.findMany({
      where: search ? { OR: [{ name: { contains: search } }, { state: { contains: search } }] } : undefined,
      include: {
        subscription: { include: { plan: { select: { name: true, annualFee: true } } } },
        deploymentOrder: { select: { stage: true, feeAmount: true } },
        _count: { select: { products: true, sales: true, memberships: { where: { isActive: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
}

export async function adminSetBusinessStatus(businessId: string, status: "ACTIVE" | "SUSPENDED") {
  return guarded(async () => {
    const admin = await requirePlatformAdmin();
    await db.business.update({ where: { id: businessId }, data: { status } });
    await audit({
      actorId: admin.userId,
      actorLabel: `${admin.userName} (PLATFORM_ADMIN)`,
      action: "BUSINESS_STATUS_CHANGE",
      entityType: "Business",
      entityId: businessId,
      meta: { status },
    });
    return { ok: true };
  });
}

export async function adminGrantComplimentaryDays(businessId: string, days: number, reason: string) {
  return guarded(async () => {
    const d = z.object({ days: z.number().int().min(1).max(365), reason: z.string().min(5).max(300) }).parse({ days, reason });
    const admin = await requirePlatformAdmin();
    const sub = await db.subscription.findUnique({ where: { businessId } });
    if (!sub) throw new Error("Business has no subscription.");
    const base = sub.endDate && sub.endDate > new Date() ? sub.endDate : new Date();
    const newEnd = new Date(base.getTime() + d.days * 864e5);
    await db.subscription.update({
      where: { id: sub.id },
      data: { status: "ACTIVE", endDate: newEnd, graceEndDate: new Date(newEnd.getTime() + 7 * 864e5) },
    });
    await db.business.update({ where: { id: businessId }, data: { status: "ACTIVE" } });
    await audit({
      businessId,
      actorId: admin.userId,
      actorLabel: `${admin.userName} (PLATFORM_ADMIN)`,
      action: "COMPLIMENTARY_EXTENSION",
      entityType: "Subscription",
      entityId: sub.id,
      reason: d.reason,
      meta: { days: d.days, newEnd: newEnd.toISOString() },
    });
    await db.notification.create({
      data: {
        businessId,
        type: "RENEWAL",
        title: `Complimentary ${d.days}-day extension applied`,
        body: d.reason,
        severity: "INFO",
      },
    });
    return { ok: true, newEnd: newEnd.toISOString() };
  });
}

/* ─────────────────── Platform admin: deployment pipeline ─────────────────── */

const STAGES = ["AWAITING_PAYMENT", "PAYMENT_CONFIRMED", "AWAITING_SETUP", "SETUP_IN_PROGRESS", "AWAITING_CUSTOMER_DATA", "READY_FOR_VERIFICATION", "LIVE"] as const;

export async function adminAdvanceDeployment(deploymentId: string, stage: (typeof STAGES)[number], notes?: string) {
  return guarded(async () => {
    const admin = await requirePlatformAdmin();
    const deployment = await db.deploymentOrder.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new Error("Deployment order not found.");
    if (STAGES.indexOf(stage) < STAGES.indexOf(deployment.stage as (typeof STAGES)[number])) {
      throw new Error("Deployment stage cannot move backwards.");
    }
    await db.deploymentOrder.update({
      where: { id: deploymentId },
      data: { stage, notes: notes ?? deployment.notes, completedAt: stage === "LIVE" ? new Date() : deployment.completedAt },
    });
    await audit({
      businessId: deployment.businessId,
      actorId: admin.userId,
      actorLabel: `${admin.userName} (PLATFORM_ADMIN)`,
      action: AUDIT_ACTIONS.DEPLOYMENT_STAGE_CHANGE,
      entityType: "DeploymentOrder",
      entityId: deploymentId,
      meta: { from: deployment.stage, to: stage, notes },
    });
    return { ok: true };
  });
}

/* ─────────────────── Platform admin: plans & pricing ─────────────────── */

export async function adminSavePlan(input: unknown) {
  return guarded(async () => {
    const d = z.object({
      id: z.string().optional(),
      name: z.string().min(2).max(60),
      annualFee: z.number().min(0),
      deploymentFee: z.number().min(0),
      maxTerminals: z.number().int().min(1).max(50),
      aiMonthlyLimit: z.number().int().min(0).max(100000),
      isActive: z.boolean().default(true),
    }).parse(input);
    const admin = await requirePlatformAdmin();
    if (d.id) {
      await db.plan.update({ where: { id: d.id }, data: { name: d.name, annualFee: money(d.annualFee), deploymentFee: money(d.deploymentFee), maxTerminals: d.maxTerminals, aiMonthlyLimit: d.aiMonthlyLimit, isActive: d.isActive } });
    } else {
      await db.plan.create({ data: { name: d.name, annualFee: money(d.annualFee), deploymentFee: money(d.deploymentFee), maxTerminals: d.maxTerminals, aiMonthlyLimit: d.aiMonthlyLimit, isActive: d.isActive, featuresJson: "[]" } });
    }
    await audit({
      actorId: admin.userId,
      actorLabel: `${admin.userName} (PLATFORM_ADMIN)`,
      action: AUDIT_ACTIONS.PLAN_CHANGE,
      entityType: "Plan",
      entityId: d.id ?? "new",
      meta: { name: d.name, annualFee: d.annualFee, deploymentFee: d.deploymentFee },
    });
    return { ok: true };
  });
}

export async function adminSavePricingConfig(input: unknown) {
  return guarded(async () => {
    const d = z.object({
      deploymentFee: z.number().min(0),
      annualSubscriptionFee: z.number().min(0),
      gracePeriodDays: z.number().int().min(0).max(60),
      reminderDaysBefore: z.array(z.number().int()).max(6),
    }).parse(input);
    const admin = await requirePlatformAdmin();
    await db.platformSetting.upsert({
      where: { key: "pricing" },
      update: { valueJson: JSON.stringify({ ...d, currency: "NGN", firstYearTotal: d.deploymentFee + d.annualSubscriptionFee, renewalFee: d.annualSubscriptionFee }), updatedBy: admin.userId },
      create: { key: "pricing", valueJson: JSON.stringify({ ...d, currency: "NGN" }), updatedBy: admin.userId },
    });
    await audit({
      actorId: admin.userId,
      actorLabel: `${admin.userName} (PLATFORM_ADMIN)`,
      action: AUDIT_ACTIONS.PLAN_CHANGE,
      entityType: "PlatformSetting",
      entityId: "pricing",
      meta: d,
    });
    return { ok: true };
  });
}

export async function adminListPlans() {
  return guarded(async () => {
    await requirePlatformAdmin();
    const plans = await db.plan.findMany({ orderBy: { createdAt: "asc" } });
    const pricing = await db.platformSetting.findUnique({ where: { key: "pricing" } });
    return { plans, pricing: pricing ? JSON.parse(pricing.valueJson) : null };
  });
}

/* ─────────────────── Platform admin: invoices & payments ─────────────────── */

export async function adminIssueInvoice(businessId: string, kind: "DEPLOYMENT" | "SUBSCRIPTION" | "MIXED" | "CUSTOM", notes?: string) {
  return guarded(async () => {
    const admin = await requirePlatformAdmin();
    const [business, plan] = await Promise.all([
      db.business.findUnique({ where: { id: businessId } }),
      (async () => {
        const sub = await db.subscription.findUnique({ where: { businessId }, include: { plan: true } });
        if (sub) return sub.plan;
        return db.plan.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
      })(),
    ]);
    if (!business) throw new Error("Business not found.");
    if (!plan) throw new Error("No plan configured.");

    const invoice = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, businessId, "INV");
      const lines: { kind: string; description: string; quantity: Prisma.Decimal; unitAmount: Prisma.Decimal; amount: Prisma.Decimal }[] = [];
      if (kind === "DEPLOYMENT" || kind === "MIXED") {
        lines.push({ kind: "DEPLOYMENT", description: "One-time deployment & setup", quantity: dec(1), unitAmount: dec(plan.deploymentFee), amount: dec(plan.deploymentFee) });
      }
      if (kind === "SUBSCRIPTION" || kind === "MIXED") {
        lines.push({ kind: "SUBSCRIPTION", description: `${plan.name} plan — annual subscription (12 months)`, quantity: dec(1), unitAmount: dec(plan.annualFee), amount: dec(plan.annualFee) });
      }
      if (!lines.length) lines.push({ kind: "OTHER", description: notes || "Custom charge", quantity: dec(1), unitAmount: dec(0), amount: dec(0) });
      const total = money(lines.reduce((acc, l) => acc.add(l.amount), dec(0)));
      const created = await tx.invoice.create({
        data: {
          businessId, number, kind, status: "ISSUED",
          subtotal: total, total, issuedAt: new Date(), dueAt: new Date(Date.now() + 14 * 864e5),
          notes: notes || null,
        },
      });
      for (const l of lines) {
        await tx.invoiceLine.create({ data: { invoiceId: created.id, kind: l.kind, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount, amount: l.amount } });
      }
      return created;
    });

    await audit({
      businessId,
      actorId: admin.userId,
      actorLabel: `${admin.userName} (PLATFORM_ADMIN)`,
      action: AUDIT_ACTIONS.INVOICE_ISSUED,
      entityType: "Invoice",
      entityId: invoice.id,
      meta: { number: invoice.number, kind, total: invoice.total.toString() },
    });
    return { ok: true, invoiceId: invoice.id, number: invoice.number };
  });
}

export async function adminRecordManualPayment(businessId: string, invoiceId: string, amount: number, method: string, reference: string) {
  return guarded(async () => {
    const d = z.object({
      amount: z.number().positive(),
      method: z.enum(["CASH", "TRANSFER", "CARD"]),
      reference: z.string().min(3).max(80),
    }).parse({ amount, method, reference });
    const admin = await requirePlatformAdmin();

    const invoice = await db.invoice.findFirst({ where: { id: invoiceId, businessId } });
    if (!invoice) throw new Error("Invoice not found.");

    // Idempotent on reference
    const existing = await db.paymentTransaction.findUnique({ where: { reference: d.reference } });
    if (existing) {
      if (existing.status === "SUCCESS") return { ok: true, applied: false, note: "Reference already processed." };
    }

    const payment = await db.paymentTransaction.upsert({
      where: { reference: d.reference },
      update: { amount: money(d.amount), status: "PENDING", invoiceId },
      create: { businessId, invoiceId, provider: "MANUAL", reference: d.reference, method: d.method, amount: money(d.amount), status: "PENDING", purpose: "CUSTOM" },
    });

    // Record the verifying admin, but let applyVerifiedPayment own the
    // status state machine (its idempotency guard skips SUCCESS rows).
    await db.paymentTransaction.update({
      where: { reference: d.reference },
      data: { verifiedById: admin.userId, channelJson: JSON.stringify({ via: "ADMIN_MANUAL", verifiedBy: admin.userName, at: new Date().toISOString() }) },
    });
    const applied = await applyVerifiedPayment(d.reference, "ADMIN_MANUAL");
    return { ok: true, applied: applied.applied, invoiceNumber: applied.invoiceNumber };
  });
}

export async function adminListWebhookEvents() {
  return guarded(async () => {
    await requirePlatformAdmin();
    return db.webhookEvent.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  });
}

/* ─────────────────── Platform admin: announcements ─────────────────── */

export async function adminCreateAnnouncement(title: string, body: string) {
  return guarded(async () => {
    const d = z.object({ title: z.string().min(3).max(120), body: z.string().min(3).max(1000) }).parse({ title, body });
    const admin = await requirePlatformAdmin();
    await db.announcement.create({ data: { title: d.title, body: d.body, audience: "ALL" } });
    return { ok: true };
  });
}

export async function adminRunReminderSweep() {
  return guarded(async () => {
    const admin = await requirePlatformAdmin();
    const created = await generateRenewalReminders();
    return { ok: true, created };
  });
}
