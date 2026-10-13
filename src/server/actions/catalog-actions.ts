"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requirePermission } from "@/lib/guards";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { dec, money } from "@/lib/money";

/* ─────────────────────────── Categories ─────────────────────────── */

const categorySchema = z.object({
  businessId: z.string(),
  name: z.string().min(1).max(80),
  department: z.enum(["PHARMACY", "SUPERMARKET"]),
});

export async function createCategory(input: unknown) {
  return guarded(async () => {
    const d = categorySchema.parse(input);
    const ctx = await requirePermission(d.businessId, "product.create");
    const cat = await db.category.create({
      data: { businessId: ctx.businessId, name: d.name, department: d.department },
    });
    return { ok: true, category: cat };
  });
}

export async function listCategories(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "product.view");
    return db.category.findMany({
      where: { businessId: ctx.businessId },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    });
  });
}

/* ─────────────────────────── Products ─────────────────────────── */

const productSchema = z.object({
  businessId: z.string(),
  name: z.string().min(1).max(140),
  sku: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  categoryId: z.string().optional().nullable(),
  department: z.enum(["PHARMACY", "SUPERMARKET", "BOTH"]),
  type: z.enum(["MEDICINE", "RETAIL"]),
  costPrice: z.number().min(0),
  sellingPrice: z.number().min(0),
  baseUnit: z.string().min(1).max(20),
  reorderLevel: z.number().min(0),
  taxRate: z.number().min(0).max(50).default(0),
  barcode: z.string().max(60).optional().nullable(),
  conversions: z.array(z.object({ fromUnit: z.string().min(1).max(20), factor: z.number().positive() })).max(6).default([]),
});

export async function createProduct(input: unknown) {
  return guarded(async () => {
    const d = productSchema.parse(input);
    const ctx = await requirePermission(d.businessId, "product.create");
    if (d.sellingPrice < d.costPrice && d.type === "RETAIL") {
      // allowed but unusual — no block, price policy is business decision
    }
    const dupSku = await db.product.findFirst({ where: { businessId: ctx.businessId, sku: d.sku } });
    if (dupSku) throw new Error(`SKU "${d.sku}" is already used by another product in your business.`);
    if (d.barcode) {
      const dupBarcode = await db.barcode.findFirst({ where: { businessId: ctx.businessId, code: d.barcode } });
      if (dupBarcode) throw new Error(`Barcode "${d.barcode}" is already assigned to another product.`);
    }

    const product = await db.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          businessId: ctx.businessId,
          name: d.name,
          sku: d.sku,
          description: d.description ?? null,
          categoryId: d.categoryId ?? null,
          department: d.department,
          type: d.type,
          trackBatches: d.type === "MEDICINE",
          costPrice: money(d.costPrice),
          sellingPrice: money(d.sellingPrice),
          baseUnit: d.baseUnit,
          reorderLevel: dec(d.reorderLevel),
          taxRate: dec(d.taxRate),
        },
      });
      if (d.barcode) {
        await tx.barcode.create({ data: { businessId: ctx.businessId, productId: created.id, code: d.barcode } });
      }
      for (const c of d.conversions) {
        await tx.unitConversion.create({
          data: { productId: created.id, fromUnit: c.fromUnit, toUnit: d.baseUnit, factor: dec(c.factor) },
        });
      }
      return created;
    });

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.PRODUCT_CREATED,
      entityType: "Product",
      entityId: product.id,
      meta: { name: d.name, sku: d.sku, price: d.sellingPrice, cost: d.costPrice },
    });
    return { ok: true, product };
  });
}

export async function updateProduct(input: unknown) {
  return guarded(async () => {
    const d = productSchema.extend({ id: z.string() }).parse(input);
    const ctx = await requirePermission(d.businessId, "product.update");
    const existing = await db.product.findFirst({ where: { id: d.id, businessId: ctx.businessId } });
    if (!existing) throw new Error("Product not found.");

    const priceChanged = !money(d.sellingPrice).eq(existing.sellingPrice) || !money(d.costPrice).eq(existing.costPrice);
    if (priceChanged) {
      await requirePermission(d.businessId, "product.priceChange");
    }

    const product = await db.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: existing.id },
        data: {
          name: d.name,
          sku: d.sku,
          description: d.description ?? null,
          categoryId: d.categoryId ?? null,
          department: d.department,
          type: d.type,
          trackBatches: d.type === "MEDICINE",
          costPrice: money(d.costPrice),
          sellingPrice: money(d.sellingPrice),
          baseUnit: d.baseUnit,
          reorderLevel: dec(d.reorderLevel),
          taxRate: dec(d.taxRate),
        },
      });
      if (d.barcode) {
        const current = await tx.barcode.findFirst({ where: { productId: existing.id } });
        if (current) {
          await tx.barcode.update({ where: { id: current.id }, data: { code: d.barcode } });
        } else {
          await tx.barcode.create({ data: { businessId: ctx.businessId, productId: existing.id, code: d.barcode } });
        }
      }
      // Rebuild conversions
      await tx.unitConversion.deleteMany({ where: { productId: existing.id } });
      for (const c of d.conversions) {
        await tx.unitConversion.create({
          data: { productId: existing.id, fromUnit: c.fromUnit, toUnit: d.baseUnit, factor: dec(c.factor) },
        });
      }
      return updated;
    });

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: priceChanged ? AUDIT_ACTIONS.PRICE_CHANGE : AUDIT_ACTIONS.PRODUCT_UPDATED,
      entityType: "Product",
      entityId: product.id,
      meta: priceChanged
        ? { name: d.name, oldPrice: existing.sellingPrice.toString(), newPrice: d.sellingPrice.toString(), oldCost: existing.costPrice.toString(), newCost: d.costPrice.toString() }
        : { name: d.name },
    });
    return { ok: true, product };
  });
}

export async function setProductActive(businessId: string, productId: string, isActive: boolean) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "product.update");
    const product = await db.product.findFirst({ where: { id: productId, businessId: ctx.businessId } });
    if (!product) throw new Error("Product not found.");
    await db.product.update({ where: { id: productId }, data: { isActive } });
    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.PRODUCT_UPDATED,
      entityType: "Product",
      entityId: productId,
      meta: { isActive },
    });
    return { ok: true };
  });
}

export async function listProducts(businessId: string, opts?: { department?: string; search?: string }) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "product.view");
    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (opts?.department && opts.department !== "ALL") {
      where.OR = [{ department: opts.department }, { department: "BOTH" }];
    }
    if (opts?.search) {
      where.name = { contains: opts.search };
    }
    const products = await db.product.findMany({
      where,
      include: {
        category: true,
        barcodes: true,
        conversions: true,
        stockBalance: true,
      },
      orderBy: { name: "asc" },
    });
    return products;
  });
}

/* ─────────────────────────── CSV import ─────────────────────────── */

const importSchema = z.object({
  businessId: z.string(),
  rows: z.array(z.object({
    name: z.string().min(1),
    sku: z.string().min(1),
    barcode: z.string().optional(),
    department: z.string(),
    type: z.string(),
    costPrice: z.number(),
    sellingPrice: z.number(),
    baseUnit: z.string(),
    reorderLevel: z.number(),
    categoryName: z.string().optional(),
  })).min(1).max(2000),
  fileName: z.string().max(200).default("pasted.csv"),
});

export async function importProducts(input: unknown) {
  return guarded(async () => {
    const d = importSchema.parse(input);
    const ctx = await requirePermission(d.businessId, "product.import");

    // Row-level validation — invalid rows are NEVER silently dropped
    const errors: { row: number; field?: string; message: string }[] = [];
    const valid: { name: string; sku: string; barcode?: string; department: string; type: string; costPrice: number; sellingPrice: number; baseUnit: string; reorderLevel: number; categoryName?: string }[] = [];
    const skuSeen = new Set<string>();
    const barcodeSeen = new Set<string>();

    const existingProducts = await db.product.findMany({ where: { businessId: ctx.businessId }, select: { sku: true } });
    const existingSkus = new Set(existingProducts.map((p) => p.sku));
    const existingBarcodes = new Set(
      (await db.barcode.findMany({ where: { businessId: ctx.businessId }, select: { code: true } })).map((b) => b.code)
    );

    d.rows.forEach((row, idx) => {
      const rowNo = idx + 1;
      if (!row.name?.trim()) errors.push({ row: rowNo, field: "name", message: "Product name is required" });
      if (!row.sku?.trim()) errors.push({ row: rowNo, field: "sku", message: "SKU is required" });
      if (skuSeen.has(row.sku) || existingSkus.has(row.sku)) errors.push({ row: rowNo, field: "sku", message: `Duplicate SKU "${row.sku}"` });
      if (row.barcode && (barcodeSeen.has(row.barcode) || existingBarcodes.has(row.barcode)))
        errors.push({ row: rowNo, field: "barcode", message: `Duplicate barcode "${row.barcode}"` });
      if (!["PHARMACY", "SUPERMARKET", "BOTH"].includes(row.department))
        errors.push({ row: rowNo, field: "department", message: `Department must be PHARMACY, SUPERMARKET or BOTH (got "${row.department}")` });
      if (!["MEDICINE", "RETAIL"].includes(row.type))
        errors.push({ row: rowNo, field: "type", message: `Type must be MEDICINE or RETAIL (got "${row.type}")` });
      if (!(row.costPrice >= 0)) errors.push({ row: rowNo, field: "costPrice", message: "Cost price must be ≥ 0" });
      if (!(row.sellingPrice >= 0)) errors.push({ row: rowNo, field: "sellingPrice", message: "Selling price must be ≥ 0" });
      if (!row.baseUnit?.trim()) errors.push({ row: rowNo, field: "baseUnit", message: "Base unit is required" });

      if (!errors.some((e) => e.row === rowNo)) {
        valid.push(row);
        skuSeen.add(row.sku);
        if (row.barcode) barcodeSeen.add(row.barcode);
      }
    });

    const job = await db.importJob.create({
      data: {
        businessId: ctx.businessId,
        type: "PRODUCTS",
        fileName: d.fileName,
        status: errors.length ? (valid.length ? "VALIDATED" : "FAILED") : "IMPORTED",
        totalRows: d.rows.length,
        validRows: valid.length,
        errorCount: errors.length,
        errorsJson: errors.length ? JSON.stringify(errors.slice(0, 200)) : null,
        createdById: ctx.userId,
      },
    });

    // Import valid rows (map category names)
    let imported = 0;
    if (valid.length && errors.length === 0) {
      const cats = await db.category.findMany({ where: { businessId: ctx.businessId } });
      for (const row of valid) {
        const cat = row.categoryName ? cats.find((c) => c.name.toLowerCase() === row.categoryName!.toLowerCase()) : null;
        await db.product.create({
          data: {
            businessId: ctx.businessId,
            name: row.name,
            sku: row.sku,
            department: row.department,
            type: row.type,
            trackBatches: row.type === "MEDICINE",
            costPrice: money(row.costPrice),
            sellingPrice: money(row.sellingPrice),
            baseUnit: row.baseUnit,
            reorderLevel: dec(row.reorderLevel),
            categoryId: cat?.id ?? null,
          },
        });
        if (row.barcode) {
          await db.barcode.create({ data: { businessId: ctx.businessId, productId: (await db.product.findFirst({ where: { businessId: ctx.businessId, sku: row.sku } }))!.id, code: row.barcode } });
        }
        imported++;
      }
      await db.importJob.update({ where: { id: job.id }, data: { status: "IMPORTED" } });
    }

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: `${ctx.userName} (${ctx.role})`,
      action: AUDIT_ACTIONS.PRODUCT_IMPORTED,
      entityType: "ImportJob",
      entityId: job.id,
      meta: { total: d.rows.length, imported, errors: errors.length },
    });

    return { ok: true, jobId: job.id, total: d.rows.length, imported, errors: errors.slice(0, 100) };
  });
}
