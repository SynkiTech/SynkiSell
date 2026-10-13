"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requirePermission } from "@/lib/guards";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { dec, money } from "@/lib/money";

/* ─────────────────────────── Expenses ─────────────────────────── */

const expenseSchema = z.object({
  businessId: z.string(),
  categoryId: z.string().optional().nullable(),
  amount: z.number().positive(),
  date: z.string(),
  paymentMethod: z.enum(["CASH", "TRANSFER", "CARD"]),
  description: z.string().min(3).max(300),
  payee: z.string().max(120).optional(),
  receiptRef: z.string().max(200).optional(),
});

export async function createExpense(input: unknown) {
  return guarded(async () => {
    const d = expenseSchema.parse(input);
    const ctx = await requirePermission(d.businessId, "expense.create");
    const expense = await db.expense.create({
      data: {
        businessId: ctx.businessId,
        categoryId: d.categoryId ?? null,
        amount: money(d.amount),
        date: new Date(d.date),
        paymentMethod: d.paymentMethod,
        description: d.description,
        payee: d.payee || null,
        receiptRef: d.receiptRef || null,
        // Managers/owners auto-approve their own; others go to PENDING
        status: ctx.permissions.has("expense.approve") ? "APPROVED" : "PENDING",
        enteredById: ctx.userId,
      },
    });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.EXPENSE_RECORDED,
      entityType: "Expense",
      entityId: expense.id,
      meta: { amount: d.amount, description: d.description, method: d.paymentMethod },
    });
    return { ok: true, expenseId: expense.id, status: expense.status };
  });
}

export async function approveExpense(businessId: string, expenseId: string, approve: boolean) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "expense.approve");
    const expense = await db.expense.findFirst({ where: { id: expenseId, businessId: ctx.businessId } });
    if (!expense) throw new Error("Expense not found.");
    await db.expense.update({ where: { id: expenseId }, data: { status: approve ? "APPROVED" : "REJECTED" } });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.EXPENSE_APPROVED,
      entityType: "Expense",
      entityId: expenseId,
      reason: approve ? "Approved" : "Rejected",
      meta: { amount: expense.amount.toString(), description: expense.description },
    });
    return { ok: true };
  });
}

export async function listExpenses(businessId: string, from?: string, to?: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "expense.view");
    return db.expense.findMany({
      where: {
        businessId: ctx.businessId,
        ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      },
      include: { category: { select: { name: true } }, enteredBy: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 200,
    });
  });
}

export async function listExpenseCategories(businessId: string) {
  return guarded(async () => {
    await requirePermission(businessId, "expense.view");
    return db.expenseCategory.findMany({ where: { businessId }, orderBy: { name: "asc" } });
  });
}
