"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { guarded, requireAuth, requireBusiness } from "@/lib/guards";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

const registerSchema = z.object({
  ownerName: z.string().min(2).max(80),
  email: z.string().email().max(120),
  password: z.string().min(8).max(100),
  phone: z.string().max(30).optional(),
  businessName: z.string().min(2).max(120),
  businessType: z.enum(["PHARMACY", "SUPERMARKET", "COMBINED"]),
  state: z.string().min(2).max(40),
  address: z.string().max(200).optional(),
});

export async function registerBusiness(input: unknown) {
  return guarded(async () => {
    const data = registerSchema.parse(input);
    const email = data.email.trim().toLowerCase();

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) throw new Error("An account with this email already exists. Please sign in.");

    const slugBase = data.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "business";
    let slug = slugBase;
    let n = 1;
    while (await db.business.findUnique({ where: { slug } })) slug = `${slugBase}-${n++}`;

    const user = await db.user.create({
      data: {
        email,
        name: data.ownerName,
        phone: data.phone,
        passwordHash: hashPassword(data.password),
        emailVerified: new Date(),
      },
    });

    const business = await db.business.create({
      data: {
        name: data.businessName,
        slug,
        businessType: data.businessType,
        state: data.state,
        address: data.address,
        phone: data.phone,
        email,
        currency: "NGN",
        timezone: "Africa/Lagos",
        receiptHeader: data.businessName,
      },
    });

    await db.membership.create({
      data: { userId: user.id, businessId: business.id, role: "OWNER", isActive: true },
    });

    // Default expense categories for every new business
    for (const name of ["Rent", "Electricity & Utilities", "Salaries & Wages", "Transport & Logistics", "Internet & Airtime", "Maintenance", "Marketing", "Miscellaneous"]) {
      await db.expenseCategory.create({ data: { businessId: business.id, name } });
    }

    // Default plan subscription (pending payment) + deployment order
    const plan = await db.plan.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
    if (plan) {
      await db.subscription.create({
        data: { businessId: business.id, planId: plan.id, status: "PENDING_PAYMENT" },
      });
      await db.deploymentOrder.create({
        data: { businessId: business.id, stage: "AWAITING_PAYMENT", feeAmount: plan.deploymentFee },
      });
    }

    await audit({
      businessId: business.id,
      actorId: user.id,
      actorLabel: `${email} (OWNER)`,
      action: AUDIT_ACTIONS.BUSINESS_REGISTERED,
      entityType: "Business",
      entityId: business.id,
      meta: { businessType: data.businessType, state: data.state },
    });

    return { ok: true, email, businessId: business.id };
  });
}

export async function switchBusiness(businessId: string) {
  return guarded(async () => {
    const auth = await requireAuth();
    const membership = await db.membership.findFirst({
      where: { userId: auth.userId, businessId, isActive: true },
      include: { business: { select: { name: true } } },
    });
    if (!membership) throw new Error("You do not have access to that business.");
    return { ok: true, businessId, businessName: membership.business.name };
  });
}

export async function changePassword(current: string, next: string) {
  return guarded(async () => {
    const { verifyPassword } = await import("@/lib/password");
    const auth = await requireAuth();
    if (next.length < 8) throw new Error("New password must be at least 8 characters.");
    const user = await db.user.findUnique({ where: { id: auth.userId } });
    if (!user || !verifyPassword(current, user.passwordHash)) throw new Error("Current password is incorrect.");
    await db.user.update({ where: { id: auth.userId }, data: { passwordHash: hashPassword(next) } });
    await audit({
      actorId: auth.userId,
      actorLabel: auth.userName,
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: auth.userId,
    });
    return { ok: true };
  });
}

export async function getActiveBusinessForUser() {
  return guarded(async () => {
    const auth = await requireAuth();
    const memberships = await db.membership.findMany({
      where: { userId: auth.userId, isActive: true },
      include: { business: { select: { id: true, name: true, businessType: true } } },
      orderBy: { createdAt: "asc" },
    });
    return { memberships };
  });
}
