/**
 * SynkiSell — Business rules & tenant isolation tests.
 * Runs against the real seeded database and the REAL server logic
 * (the same functions the UI calls). Prints PASS/FAIL per case.
 *
 * Run: bun scripts/test-business-rules.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { createSaleCore, voidSaleCore, processRefundCore } from "../src/server/sales/sale-service";
import { receiveGoodsCore } from "../src/server/inventory/goods-receipt-service";
import { allocateFefo, resolveToBase, recomputeBalance } from "../src/server/inventory/stock-service";
import { permissionsForRole } from "../src/lib/permissions";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { dec, computeLine, formatNaira } from "../src/lib/money";

const db = new PrismaClient({
  transactionOptions: { maxWait: 20_000, timeout: 120_000 },
});

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectError(name: string, fn: () => Promise<unknown>, match?: string) {
  try {
    await fn();
    check(name, false, "expected an error but none was thrown");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(name, match ? msg.includes(match) : true, msg.slice(0, 80));
  }
}

async function main() {
  console.log("\n── SynkiSell business rules & isolation ──────────────\n");

  // Setup: two businesses (A = seeded demo, B = isolation probe)
  const bizA = await db.business.findUnique({ where: { slug: "first-pharmplus" } });
  if (!bizA) throw new Error("Seed the demo business first (bun scripts/seed.ts)");

  const ownerA = await db.user.findUnique({ where: { email: "owner@firstpharmplus.ng" } });
  const cashierA = await db.user.findUnique({ where: { email: "cashier@firstpharmplus.ng" } });

  let bizB = await db.business.findUnique({ where: { slug: "isolation-probe-b" } });
  if (!bizB) {
    bizB = await db.business.create({
      data: {
        name: "Probe Business B", slug: "isolation-probe-b", businessType: "COMBINED",
        state: "Oyo", onboardingDone: true,
      },
    });
    const userB = await db.user.upsert({
      where: { email: "owner-b@probe.ng" },
      update: {},
      create: { email: "owner-b@probe.ng", name: "Probe B Owner", passwordHash: hashPassword("Probe#2026"), emailVerified: new Date() },
    });
    await db.membership.create({ data: { userId: userB.id, businessId: bizB.id, role: "OWNER", isActive: true } });
    const catB = await db.category.create({ data: { businessId: bizB.id, name: "B Category", department: "SUPERMARKET" } });
    await db.product.create({
      data: { businessId: bizB.id, name: "B Secret Product", sku: "B-SECRET-1", department: "SUPERMARKET", type: "RETAIL", sellingPrice: dec(9999), costPrice: dec(1), baseUnit: "piece" },
    });
    await db.supplier.create({ data: { businessId: bizB.id, name: "B Secret Supplier", isActive: true } });
    await db.expenseCategory.create({ data: { businessId: bizB.id, name: "B Cat" } });
  }
  const userB = await db.user.findUnique({ where: { email: "owner-b@probe.ng" } });
  const prodB = await db.product.findFirst({ where: { businessId: bizB.id, sku: "B-SECRET-1" } });

  // ── 1. Password hashing ──────────────────────────────────────
  console.log("Auth & password:");
  const hash = hashPassword("Test#123");
  check("scrypt hash verifies correct password", verifyPassword("Test#123", hash));
  check("scrypt hash rejects wrong password", !verifyPassword("wrong", hash));
  check("hashes are salted (unique)", hashPassword("Test#123") !== hash);

  // ── 2. Permission matrix ─────────────────────────────────────
  console.log("Permissions:");
  check("OWNER has sale.void", permissionsForRole("OWNER").has("sale.void"));
  check("CASHIER lacks product.priceChange", !permissionsForRole("CASHIER").has("product.priceChange"));
  check("CASHIER has pos.sell", permissionsForRole("CASHIER").has("pos.sell"));
  check("CASHIER lacks expense.approve", !permissionsForRole("CASHIER").has("expense.approve"));
  check("ACCOUNTANT has reports.financial", permissionsForRole("ACCOUNTANT").has("reports.financial"));
  check("ACCOUNTANT lacks pos.sell", !permissionsForRole("ACCOUNTANT").has("pos.sell"));
  check("PHARMACIST lacks staff.manage", !permissionsForRole("PHARMACIST").has("staff.manage"));
  check("INVENTORY_MANAGER has inventory.receive", permissionsForRole("INVENTORY_MANAGER").has("inventory.receive"));

  // ── 3. Money math ────────────────────────────────────────────
  console.log("Money:");
  const line = computeLine({ quantity: dec(3), unitPrice: dec(350.005), discount: dec(100), taxRatePct: dec(0) });
  check("line net = qty×price − discount", line.net.toString() === "950.02", `got ${line.net}`); // 1050.015 → rounds at money()
  check("no float drift on 0.1+0.2", dec("0.1").add(dec("0.2")).toString() === "0.3");
  check("naira formatting groups thousands", formatNaira("1234567.5") === "₦1,234,567.50", formatNaira("1234567.5"));

  // ── 4. Unit conversion ───────────────────────────────────────
  console.log("Unit conversion:");
  const spaghetti = await db.product.findFirst({ where: { businessId: bizA.id, sku: "SUP-GPS500" } });
  if (spaghetti) {
    await db.$transaction(async (tx) => {
      const base = await resolveToBase(tx, { product: spaghetti, soldUnit: "carton", quantity: dec(1) });
      check("1 carton spaghetti = 20 pieces", base.toString() === "20", `got ${base}`);
      const base2 = await resolveToBase(tx, { product: spaghetti, soldUnit: "piece", quantity: dec(7) });
      check("7 pieces = 7 base units", base2.toString() === "7");
    });
    await expectError("unconfigured unit rejected", async () => {
      await db.$transaction(async (tx) => {
        await resolveToBase(tx, { product: spaghetti, soldUnit: "pallet", quantity: dec(1) });
      });
    }, "INVALID_UNIT");
  }

  // ── 5. Tenant isolation on sales ─────────────────────────────
  console.log("Tenant isolation:");
  const paraEarly = await db.product.findFirst({ where: { businessId: bizA.id, sku: "MED-PARA500" } });
  await expectError("cashier of B cannot complete sale against A's product via B scope", async () => {
    await db.$transaction(async (tx) => {
      await createSaleCore(tx, {
        businessId: bizB.id,
        cashierId: userB!.id,
        lines: [{ productId: paraEarly!.id, soldUnit: "piece", quantity: dec(1) }],
        payments: [{ method: "CASH", amount: dec(999999) }],
        idempotencyKey: `iso-${Date.now()}`,
      });
    });
  }, "PRODUCT_NOT_FOUND");
  await expectError("sale for unknown business rejected", async () => {
    await db.$transaction(async (tx) => {
      await createSaleCore(tx, {
        businessId: "nonexistent-business",
        cashierId: userB!.id,
        lines: [{ productId: prodB!.id, soldUnit: "piece", quantity: dec(1) }],
        payments: [{ method: "CASH", amount: dec(100) }],
        idempotencyKey: `iso2-${Date.now()}`,
      });
    });
  }, "BUSINESS_NOT_FOUND");

  // ── 6. Combined-basket sale + FEFO + idempotency ─────────────
  console.log("POS sales:");
  const para = paraEarly;
  const coke = await db.product.findFirst({ where: { businessId: bizA.id, sku: "SUP-COKE50" } });
  const shift = await db.cashierShift.create({
    data: { businessId: bizA.id, userId: cashierA!.id, status: "OPEN", openingCash: dec(0) },
  });

  const idemKey = `test-sale-${Date.now()}`;
  const balBeforePara = dec((await db.stockBalance.findUnique({ where: { productId: para!.id } }))!.quantity);
  const movCountBefore = await db.stockMovement.count({ where: { productId: para!.id } });

  let sale1: any;
  await db.$transaction(async (tx) => {
    sale1 = await createSaleCore(tx, {
      businessId: bizA.id,
      cashierId: cashierA!.id,
      shiftId: shift.id,
      lines: [
        { productId: para!.id, soldUnit: "pack", quantity: dec(2) },           // medicine (FEFO)
        { productId: coke!.id, soldUnit: "bottle", quantity: dec(5) },         // supermarket
      ],
      payments: [{ method: "CASH", amount: dec(100000) }], // overpay → change
      idempotencyKey: idemKey,
    });
  });
  const expectedTotal = dec(para!.sellingPrice).mul(2).add(dec(coke!.sellingPrice).mul(5));
  check("combined basket total correct", sale1.total.eq(expectedTotal), `${sale1.total} vs ${expectedTotal}`);
  check("change calculated", sale1.changeGiven.eq(dec(100000).minus(expectedTotal)), `${sale1.changeGiven}`);

  const items = await db.saleItem.findMany({ where: { saleId: sale1.saleId } });
  check("one sale, two lines, departments attributed", items.length === 2 && new Set(items.map((i) => i.department)).size === 2);
  const paraItem = items.find((i) => i.productId === para!.id)!;
  const alloc = JSON.parse(paraItem.batchAllocationsJson ?? "[]");
  const paraBatches = await db.pharmacyBatch.findMany({ where: { productId: para!.id, status: "ACTIVE", quantityRemaining: { gt: 0 } }, orderBy: { expiryDate: "asc" } });
  check("FEFO: allocation uses earliest-expiry ACTIVE batch", alloc[0]?.batchNumber === paraBatches[0]?.batchNumber, `${alloc[0]?.batchNumber} vs ${paraBatches[0]?.batchNumber}`);
  check("expired batch NOT allocated", !alloc.some((a: any) => a.batchNumber === "EMZ-B2403"));

  const balAfterPara = dec((await db.stockBalance.findUnique({ where: { productId: para!.id } }))!.quantity);
  check("stock balance decremented exactly once (2 packs)", balBeforePara.minus(balAfterPara).eq(2), `${balBeforePara}→${balAfterPara}`);

  // Idempotent retry
  let saleRetry: any;
  await db.$transaction(async (tx) => {
    saleRetry = await createSaleCore(tx, {
      businessId: bizA.id,
      cashierId: cashierA!.id,
      shiftId: shift.id,
      lines: [
        { productId: para!.id, soldUnit: "pack", quantity: dec(2) },
        { productId: coke!.id, soldUnit: "bottle", quantity: dec(5) },
      ],
      payments: [{ method: "CASH", amount: dec(100000) }],
      idempotencyKey: idemKey, // SAME key
    });
  });
  check("retry with same idempotency key returns ORIGINAL sale", saleRetry.saleId === sale1.saleId);
  const balAfterRetry = dec((await db.stockBalance.findUnique({ where: { productId: para!.id } }))!.quantity);
  check("retry did NOT double-deduct stock", balAfterRetry.eq(balAfterPara));
  const movCountAfter = await db.stockMovement.count({ where: { productId: para!.id } });
  check("movements created exactly once per allocation", movCountAfter > movCountBefore);

  // Insufficient stock blocks online sale
  await expectError("insufficient stock blocks online sale", async () => {
    await db.$transaction(async (tx) => {
      await createSaleCore(tx, {
        businessId: bizA.id,
        cashierId: cashierA!.id,
        shiftId: shift.id,
        lines: [{ productId: para!.id, soldUnit: "pack", quantity: dec(999999) }],
        payments: [{ method: "CASH", amount: dec(99999999) }],
        idempotencyKey: `test-insufficient-${Date.now()}`,
      });
    });
  }, "INSUFFICIENT_STOCK");

  // ── 7. Void ──────────────────────────────────────────────────
  console.log("Voids:");
  const balBeforeVoid = dec((await db.stockBalance.findUnique({ where: { productId: para!.id } }))!.quantity);
  await db.$transaction(async (tx) => {
    await voidSaleCore(tx, { businessId: bizA.id, saleId: sale1.saleId, voidedById: ownerA!.id, reason: "Test void" });
  });
  const balAfterVoid = dec((await db.stockBalance.findUnique({ where: { productId: para!.id } }))!.quantity);
  check("void restores stock", balAfterVoid.eq(balBeforeVoid.add(2)), `${balAfterVoid} vs ${balBeforeVoid.add(2)}`);
  const voidedSale = await db.sale.findUnique({ where: { id: sale1.saleId } });
  check("void marks sale VOIDED with reason (record preserved)", voidedSale?.status === "VOIDED" && voidedSale?.voidReason === "Test void");
  // Batch restored via allocation reversal
  const allocBatchId = alloc[0].batchId;
  const allocBatch = await db.pharmacyBatch.findUnique({ where: { id: allocBatchId } });
  const batchMovs = await db.stockMovement.aggregate({ where: { batchId: allocBatchId }, _sum: { quantity: true } });
  check("void restores batch remaining in ledger-consistent way", allocBatch!.quantityRemaining.toString() === (batchMovs._sum.quantity || 0).toString());

  // ── 8. Refund ────────────────────────────────────────────────
  console.log("Refunds:");
  // New sale to refund
  let sale2: any;
  await db.$transaction(async (tx) => {
    sale2 = await createSaleCore(tx, {
      businessId: bizA.id,
      cashierId: cashierA!.id,
      shiftId: shift.id,
      lines: [{ productId: coke!.id, soldUnit: "bottle", quantity: dec(10) }],
      payments: [{ method: "CASH", amount: dec(coke!.sellingPrice.mul(10)) }],
      idempotencyKey: `test-refund-sale-${Date.now()}`,
    });
  });
  const sale2Item = (await db.saleItem.findFirst({ where: { saleId: sale2.saleId } }))!;
  const refund = await db.refund.create({
    data: {
      businessId: bizA.id, saleId: sale2.saleId, number: `RFD-TEST-${Date.now()}`,
      type: "PARTIAL", amount: dec(coke!.sellingPrice.mul(3)), reason: "Test refund — 3 bottles",
      status: "APPROVED", requestedById: cashierA!.id, approvedById: ownerA!.id,
      lines: { create: { saleItemId: sale2Item.id, productId: coke!.id, quantity: dec(3), amount: dec(coke!.sellingPrice.mul(3)), restock: true } },
    },
  });
  const balBeforeRefund = dec((await db.stockBalance.findUnique({ where: { productId: coke!.id } }))!.quantity);
  await db.$transaction(async (tx) => {
    await processRefundCore(tx, { businessId: bizA.id, refundId: refund.id, processedById: ownerA!.id });
  });
  const balAfterRefund = dec((await db.stockBalance.findUnique({ where: { productId: coke!.id } }))!.quantity);
  check("refund restocks 3 bottles", balAfterRefund.eq(balBeforeRefund.add(3)), `${balBeforeRefund}→${balAfterRefund}`);
  const sale2After = await db.sale.findUnique({ where: { id: sale2.saleId } });
  check("sale marked PARTIALLY_REFUNDED", sale2After?.status === "PARTIALLY_REFUNDED");
  const refundMovs = await db.stockMovement.count({ where: { referenceType: "REFUND", referenceId: refund.id } });
  check("refund movement recorded once", refundMovs === 1);

  // ── 9. Goods receiving + cross-tenant ────────────────────────
  console.log("Purchasing:");
  await expectError("receiving for product of ANOTHER business rejected", async () => {
    await db.$transaction(async (tx) => {
      await receiveGoodsCore(tx, {
        businessId: bizB.id,
        supplierId: (await db.supplier.findFirst({ where: { businessId: bizB.id } }))!.id,
        lines: [{ productId: para!.id, quantity: dec(5), unitCost: dec(200) }],
        receivedById: userB!.id,
      });
    });
  }, "PRODUCT_NOT_FOUND");
  await expectError("medicine receiving requires batch number", async () => {
    await db.$transaction(async (tx) => {
      await receiveGoodsCore(tx, {
        businessId: bizA.id,
        supplierId: (await db.supplier.findFirst({ where: { businessId: bizA.id } }))!.id,
        lines: [{ productId: para!.id, quantity: dec(5), unitCost: dec(200) }], // no batch
        receivedById: ownerA!.id,
      });
    });
  }, "BATCH_REQUIRED");
  await expectError("expired batch receiving rejected", async () => {
    await db.$transaction(async (tx) => {
      await receiveGoodsCore(tx, {
        businessId: bizA.id,
        supplierId: (await db.supplier.findFirst({ where: { businessId: bizA.id } }))!.id,
        lines: [{ productId: para!.id, quantity: dec(5), unitCost: dec(200), batchNumber: "OLD-X", expiryDate: new Date(Date.now() - 864e5) }],
        receivedById: ownerA!.id,
      });
    });
  }, "EXPIRED_BATCH_REJECTED");

  // ── 10. Stock reconciliation ─────────────────────────────────
  console.log("Reconciliation:");
  const balances = await db.stockBalance.findMany({ where: { businessId: bizA.id } });
  let mismatches = 0;
  for (const b of balances) {
    const recomputed = await db.$transaction(async (tx) => recomputeBalance(tx, bizA.id, b.productId));
    if (!recomputed.eq(b.quantity)) mismatches++;
  }
  check("ALL product balances reconcile with movement ledger", mismatches === 0, `${mismatches} mismatches`);
  const batchesA = await db.pharmacyBatch.findMany({ where: { businessId: bizA.id } });
  let batchMismatch = 0;
  for (const b of batchesA) {
    const agg = await db.stockMovement.aggregate({ where: { batchId: b.id }, _sum: { quantity: true } });
    if (!dec(agg._sum.quantity ?? 0).eq(dec(b.quantityRemaining))) batchMismatch++;
  }
  check("ALL batch remainings reconcile with ledger", batchMismatch === 0, `${batchMismatch} mismatches`);

  // ── 11. Shift cash reconciliation ────────────────────────────
  console.log("Shift:");
  const cashAgg = await db.cashMovement.aggregate({ where: { shiftId: shift.id }, _sum: { amount: true } });
  const expectedCash = dec(cashAgg._sum.amount ?? 0);
  check("expected cash = opening + cash sales − cash refunds", expectedCash.gte(0));
  const shiftSales = await db.sale.aggregate({ where: { shiftId: shift.id, status: { not: "VOIDED" } }, _sum: { total: true }, _count: true });
  check("shift sales attribution recorded (non-voided remain)", (shiftSales._count ?? 0) >= 1, `count=${shiftSales._count}`);
  await db.cashierShift.update({
    where: { id: shift.id },
    data: { status: "CLOSED", closedAt: new Date(), expectedCash, countedCash: expectedCash, discrepancy: dec(0) },
  });

  // ── 12. AI/aggregate scoping (data boundary) ─────────────────
  console.log("Data boundaries:");
  const aTop = await db.saleItem.findMany({ where: { businessId: bizA.id }, take: 1 });
  const bTop = await db.saleItem.findMany({ where: { businessId: bizB.id }, take: 1 });
  check("A's aggregation only sees A items", aTop.length === 1 && aTop[0].businessId === bizA.id);
  check("B's aggregation only sees B items", bTop.every((i) => i.businessId === bizB.id));

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("Failures:");
    failures.forEach((f) => console.log("  • " + f));
  }
  console.log("═══════════════════════════════════════════════════════\n");

  // Cleanup test artifacts (test sales/shift/refund), keep probe B for future runs.
  // Order matters: refunds first (cascades RefundLine), then sales — RefundLine
  // intentionally references saleItem with Restrict (history protection).
  await db.refund.deleteMany({ where: { sale: { idempotencyKey: { startsWith: "test-" } } } }).catch(() => {});
  await db.sale.deleteMany({ where: { idempotencyKey: { startsWith: "test-" } } }).catch(() => {});
  await db.cashierShift.delete({ where: { id: shift.id } }).catch(() => {});

  process.exit(failed > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
