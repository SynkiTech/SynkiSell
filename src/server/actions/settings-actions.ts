"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requirePermission } from "@/lib/guards";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

const settingsSchema = z.object({
  businessId: z.string(),
  name: z.string().min(2).max(120),
  state: z.string().min(2).max(40),
  address: z.string().max(200).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  receiptHeader: z.string().max(140),
  receiptFooter: z.string().max(200),
  defaultTaxRate: z.number().min(0).max(50),
  expiryWarningDays: z.number().int().min(7).max(365),
  logoUrl: z.string().max(300).optional().nullable(),
});

export async function saveBusinessSettings(input: unknown) {
  return guarded(async () => {
    const d = settingsSchema.parse(input);
    const ctx = await requirePermission(d.businessId, "settings.manage");
    const before = await db.business.findUnique({ where: { id: ctx.businessId } });
    const updated = await db.business.update({
      where: { id: ctx.businessId },
      data: {
        name: d.name,
        state: d.state,
        address: d.address || null,
        phone: d.phone || null,
        email: d.email || null,
        receiptHeader: d.receiptHeader,
        receiptFooter: d.receiptFooter,
        defaultTaxRate: d.defaultTaxRate.toString(),
        expiryWarningDays: d.expiryWarningDays,
        logoUrl: d.logoUrl ?? before?.logoUrl ?? null,
      },
    });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      entityType: "Business",
      entityId: ctx.businessId,
      meta: {
        name: d.name,
        taxChanged: before?.defaultTaxRate.toString() !== updated.defaultTaxRate.toString(),
      },
    });
    return { ok: true };
  });
}

export async function getBusinessSettings(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "settings.manage");
    const business = await db.business.findUnique({ where: { id: ctx.businessId } });
    if (!business) throw new Error("Business not found.");
    return {
      name: business.name,
      businessType: business.businessType,
      state: business.state,
      address: business.address,
      phone: business.phone,
      email: business.email,
      receiptHeader: business.receiptHeader,
      receiptFooter: business.receiptFooter,
      defaultTaxRate: Number(business.defaultTaxRate),
      expiryWarningDays: business.expiryWarningDays,
      logoUrl: business.logoUrl,
      currency: business.currency,
      timezone: business.timezone,
    };
  });
}
