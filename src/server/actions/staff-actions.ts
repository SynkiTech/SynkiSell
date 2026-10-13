"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requirePermission } from "@/lib/guards";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { hashPassword, generateResetToken } from "@/lib/password";
import { isValidRole } from "@/lib/permissions";

/* ─────────────────────────── Staff management ─────────────────────────── */

const staffSchema = z.object({
  businessId: z.string(),
  id: z.string().optional(),
  name: z.string().min(2).max(80),
  email: z.string().email().max(120),
  role: z.string(),
  phone: z.string().max(30).optional(),
  tempPassword: z.string().min(8).max(100).optional(),
});

export async function saveStaff(input: unknown) {
  return guarded(async () => {
    const d = staffSchema.parse(input);
    const ctx = await requirePermission(d.businessId, "staff.manage");
    if (!isValidRole(d.role)) throw new Error("Invalid role.");
    if (d.role === "OWNER") throw new Error("Ownership transfer is not allowed from staff management.");

    const email = d.email.trim().toLowerCase();
    let userId: string;
    let tempPasswordShown: string | null = null;

    if (d.id) {
      // Update role / activation of existing membership
      const membership = await db.membership.findFirst({ where: { id: d.id, businessId: ctx.businessId }, include: { user: true } });
      if (!membership) throw new Error("Staff member not found.");
      await db.membership.update({ where: { id: membership.id }, data: { role: d.role } });
      await db.user.update({ where: { id: membership.userId }, data: { name: d.name, phone: d.phone || null } });
      userId = membership.userId;
    } else {
      // Invite / create staff user
      const existing = await db.user.findUnique({ where: { email } });
      const membershipExists = existing
        ? await db.membership.findFirst({ where: { userId: existing.id, businessId: ctx.businessId } })
        : null;
      if (membershipExists) throw new Error("This user is already a member of your business.");

      if (existing) {
        userId = existing.id;
      } else {
        const tempPassword = d.tempPassword ?? `Synki-${Math.random().toString(36).slice(2, 10)}!`;
        const user = await db.user.create({
          data: { email, name: d.name, phone: d.phone || null, passwordHash: hashPassword(tempPassword), emailVerified: new Date() },
        });
        userId = user.id;
        tempPasswordShown = d.tempPassword ? null : tempPassword; // only show auto-generated
      }
      await db.membership.create({ data: { userId, businessId: ctx.businessId, role: d.role, isActive: true } });
    }

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: d.id ? AUDIT_ACTIONS.STAFF_UPDATED : AUDIT_ACTIONS.STAFF_INVITED,
      entityType: "Membership",
      entityId: d.id ?? `${ctx.businessId}:${userId}`,
      meta: { email, role: d.role },
    });

    return { ok: true, tempPassword: tempPasswordShown };
  });
}

export async function setStaffActive(businessId: string, membershipId: string, isActive: boolean) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "staff.manage");
    const membership = await db.membership.findFirst({ where: { id: membershipId, businessId: ctx.businessId } });
    if (!membership) throw new Error("Staff member not found.");
    if (membership.role === "OWNER") throw new Error("The owner account cannot be deactivated.");
    await db.membership.update({ where: { id: membershipId }, data: { isActive } });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: isActive ? "STAFF_ACTIVATED" : AUDIT_ACTIONS.STAFF_DEACTIVATED,
      entityType: "Membership",
      entityId: membershipId,
    });
    return { ok: true };
  });
}

export async function resetStaffPassword(businessId: string, membershipId: string, newPassword: string) {
  return guarded(async () => {
    if (newPassword.length < 8) throw new Error("Password must be at least 8 characters.");
    const ctx = await requirePermission(businessId, "staff.manage");
    const membership = await db.membership.findFirst({ where: { id: membershipId, businessId: ctx.businessId }, include: { user: true } });
    if (!membership) throw new Error("Staff member not found.");
    await db.user.update({ where: { id: membership.userId }, data: { passwordHash: hashPassword(newPassword) } });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: "STAFF_PASSWORD_RESET",
      entityType: "User",
      entityId: membership.userId,
      meta: { email: membership.user.email },
    });
    return { ok: true };
  });
}

export async function listStaff(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "staff.view");
    const memberships = await db.membership.findMany({
      where: { businessId: ctx.businessId },
      include: { user: { select: { name: true, email: true, phone: true, lastLoginAt: true, isActive: true } } },
      orderBy: { createdAt: "asc" },
    });
    return memberships;
  });
}

export async function listAuditEvents(businessId: string, take = 100) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "audit.view");
    return db.auditEvent.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { createdAt: "desc" },
      take,
    });
  });
}

export { generateResetToken };
