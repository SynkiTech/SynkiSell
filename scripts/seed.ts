/**
 * SynkiSell seed — platform admin, default plan, demo business with staff,
 * catalogue, suppliers, batch stock, 30 days of sales history, subscription,
 * deployment order, invoices, expenses.
 *
 * Idempotent: exits if the demo business already exists (use --force to wipe
 * and reseed the demo business).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { receiveGoodsCore } from "../src/server/inventory/goods-receipt-service";
import { createSaleCore } from "../src/server/sales/sale-service";

const db = new PrismaClient({
  // Supabase is a WAN database: the 5s default interactive-transaction timeout
  // is too tight for the seeded multi-step inventory/sales flows.
  transactionOptions: { maxWait: 20_000, timeout: 120_000 },
});

// Deterministic PRNG (mulberry32) for reproducible seeds
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261013);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const d = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);

async function main() {
  console.log("Seeding SynkiSell…");

  // ── Platform admin ──────────────────────────────────────────────
  const admin = await db.user.upsert({
    where: { email: "admin@synkisell.com" },
    update: {},
    create: {
      email: "admin@synkisell.com",
      name: "SynkiSell Platform Admin",
      passwordHash: hashPassword("SynkiAdmin#2026"),
      platformAdmin: true,
      emailVerified: new Date(),
    },
  });

  // ── Default plan & pricing config ───────────────────────────────
  const plan = await db.plan.upsert({
    where: { id: "plan-standard" },
    update: {},
    create: {
      id: "plan-standard",
      name: "Standard",
      annualFee: d(120000),
      deploymentFee: d(60000),
      currency: "NGN",
      maxTerminals: 2,
      aiMonthlyLimit: 200,
      featuresJson: JSON.stringify(["pos", "inventory", "purchasing", "reports", "ai_insights", "offline_pos"]),
    },
  });

  await db.platformSetting.upsert({
    where: { key: "pricing" },
    update: {},
    create: {
      key: "pricing",
      valueJson: JSON.stringify({
        currency: "NGN",
        deploymentFee: 60000,
        annualSubscriptionFee: 120000,
        firstYearTotal: 180000,
        renewalFee: 120000,
        gracePeriodDays: 7,
        reminderDaysBefore: [30, 14, 7, 1],
        note: "Proposed pilot prices — editable here without code changes.",
      }),
      updatedBy: admin.id,
    },
  });

  // ── Demo business ───────────────────────────────────────────────
  const existing = await db.business.findUnique({ where: { slug: "first-pharmplus" } });
  if (existing && !process.argv.includes("--force")) {
    console.log("Demo business already seeded. Use --force to reseed.");
    return;
  }
  if (existing) {
    // History tables must go first: SaleLine / GoodsReceiptLine / PurchaseOrderLine
    // intentionally reference products with Restrict (history protection), which
    // would otherwise block the business→product cascade delete.
    await db.sale.deleteMany({ where: { businessId: existing.id } });
    await db.goodsReceipt.deleteMany({ where: { businessId: existing.id } });
    await db.purchaseOrder.deleteMany({ where: { businessId: existing.id } });
    await db.business.delete({ where: { id: existing.id } });
    console.log("Removed previous demo business (--force).");
  }

  const business = await db.business.create({
    data: {
      name: "First PharmPlus Ventures",
      slug: "first-pharmplus",
      businessType: "COMBINED",
      state: "Osun",
      address: "No. 14 Fountain Square, Ogo Oluwa, Osogbo",
      phone: "+234 803 555 0142",
      email: "hello@firstpharmplus.ng",
      receiptHeader: "First PharmPlus Ventures — Pharmacy & Supermarket",
      receiptFooter: "Thanks for your patronage! No refunds after 7 days with receipt.",
      defaultTaxRate: d(0),
      expiryWarningDays: 90,
      onboardingDone: true,
      onboardingJson: JSON.stringify({ profile: true, staff: true, catalogue: true, import: true, pos: true }),
    },
  });

  const password = (p: string) => hashPassword(p);
  const mkUser = (email: string, name: string, pw: string) =>
    db.user.upsert({ where: { email }, update: { name, isActive: true }, create: { email, name, passwordHash: password(pw), emailVerified: new Date() } });
  const owner = await mkUser("owner@firstpharmplus.ng", "Adewale Ogunleye", "Owner#2026");
  const manager = await mkUser("manager@firstpharmplus.ng", "Chidinma Eze", "Manager#2026");
  const cashier = await mkUser("cashier@firstpharmplus.ng", "Tunde Bakare", "Cashier#2026");
  const storekeeper = await mkUser("store@firstpharmplus.ng", "Fatima Bello", "Store#2026");
  const pharmacist = await mkUser("pharmacist@firstpharmplus.ng", "Dr. Ngozi Okafor", "Pharma#2026");
  const accountant = await mkUser("accounts@firstpharmplus.ng", "Segun Alabi", "Accounts#2026");

  for (const [userId, role] of [
    [owner.id, "OWNER"],
    [manager.id, "MANAGER"],
    [cashier.id, "CASHIER"],
    [storekeeper.id, "INVENTORY_MANAGER"],
    [pharmacist.id, "PHARMACIST"],
    [accountant.id, "ACCOUNTANT"],
  ] as const) {
    await db.membership.create({ data: { userId, businessId: business.id, role, isActive: true } });
  }

  // ── Subscription + deployment (live demo business) ──────────────
  const subStart = new Date(Date.now() - 30 * 864e5);
  const subEnd = new Date(Date.now() + 335 * 864e5);
  await db.subscription.create({
    data: {
      businessId: business.id,
      planId: plan.id,
      status: "ACTIVE",
      startDate: subStart,
      endDate: subEnd,
      graceEndDate: new Date(subEnd.getTime() + 7 * 864e5),
      autoRenew: false,
    },
  });
  await db.deploymentOrder.create({
    data: {
      businessId: business.id,
      stage: "LIVE",
      feeAmount: d(60000),
      scheduledAt: subStart,
      completedAt: new Date(subStart.getTime() + 2 * 864e5),
      notes: "Initial pilot deployment (seeded).",
    },
  });
  const invoice = await db.invoice.create({
    data: {
      businessId: business.id,
      number: "INV-000001",
      kind: "MIXED",
      status: "PAID",
      subtotal: d(180000),
      total: d(180000),
      issuedAt: subStart,
      dueAt: subStart,
      paidAt: subStart,
      notes: "First-year onboarding: deployment + annual subscription.",
    },
  });
  await db.invoiceLine.create({
    data: { invoiceId: invoice.id, kind: "DEPLOYMENT", description: "One-time deployment & setup", quantity: d(1), unitAmount: d(60000), amount: d(60000) },
  });
  await db.invoiceLine.create({
    data: { invoiceId: invoice.id, kind: "SUBSCRIPTION", description: "Standard plan — annual subscription (12 months)", quantity: d(1), unitAmount: d(120000), amount: d(120000) },
  });
  await db.paymentTransaction.create({
    data: {
      businessId: business.id,
      invoiceId: invoice.id,
      provider: "MANUAL",
      reference: "SEED-PAY-0001",
      method: "TRANSFER",
      amount: d(180000),
      status: "SUCCESS",
      purpose: "CUSTOM",
      verifiedAt: subStart,
      verifiedById: admin.id,
      channelJson: JSON.stringify({ note: "Seeded manual transfer (test data)" }),
    },
  });

  // ── Categories ──────────────────────────────────────────────────
  const catNames: [string, string][] = [
    ["Analgesics & Antipyretics", "PHARMACY"],
    ["Antibiotics", "PHARMACY"],
    ["Antimalarials", "PHARMACY"],
    ["Vitamins & Supplements", "PHARMACY"],
    ["First Aid", "PHARMACY"],
    ["Food & Groceries", "SUPERMARKET"],
    ["Beverages", "SUPERMARKET"],
    ["Dairy", "SUPERMARKET"],
    ["Personal Care", "SUPERMARKET"],
    ["Household", "SUPERMARKET"],
  ];
  const categories: Record<string, { id: string; department: string }> = {};
  for (const [name, department] of catNames) {
    const c = await db.category.create({ data: { businessId: business.id, name, department } });
    categories[`${department}:${name}`] = { id: c.id, department };
  }

  // ── Suppliers ───────────────────────────────────────────────────
  const mkSupplier = (name: string, category: string, phone: string, terms: string) =>
    db.supplier.create({ data: { businessId: business.id, name, category, phone, paymentTerms: terms, contactName: "Sales Desk", address: "Ibadan / Lagos", isActive: true } });
  const supEmzor = await mkSupplier("Emzor Pharmaceutical Industries Ltd", "PHARMACEUTICAL_DISTRIBUTOR", "+234 802 111 2233", "Net 30");
  const supFidson = await mkSupplier("Fidson Healthcare PLC", "PHARMACEUTICAL_DISTRIBUTOR", "+234 803 444 5566", "Net 14");
  const supJustrite = await mkSupplier("Justrite Wholesale Stores", "GENERAL", "+234 805 777 8899", "Cash on delivery");
  const supUnilever = await mkSupplier("Unilever Nigeria Distributors", "GENERAL", "+234 809 222 3344", "Net 14");

  // ── Products ────────────────────────────────────────────────────
  type P = {
    name: string; sku: string; barcode: string; dept: "PHARMACY" | "SUPERMARKET" | "BOTH";
    type: "MEDICINE" | "RETAIL"; cat: string; cost: number; price: number; base: string;
    reorder: number; conv?: [string, number][]; batches?: [string, number, number, number][]; // [batchNo, daysToExpiry, qty, unitCost]
  };
  const products: P[] = [
    // Pharmacy (medicines → batch-tracked with FEFO)
    { name: "Paracetamol 500mg Tablets (10x10)", sku: "MED-PARA500", barcode: "5012345678900", dept: "PHARMACY", type: "MEDICINE", cat: "Analgesics & Antipyretics", cost: 240, price: 350, base: "pack", reorder: 40, conv: [["carton", 10]], batches: [["EMZ-B2401", 420, 180, 240], ["EMZ-B2402", 65, 120, 245], ["EMZ-B2403", -12, 15, 235]] },
    { name: "Amoxicillin 500mg Capsules", sku: "MED-AMOX500", barcode: "5012345678901", dept: "PHARMACY", type: "MEDICINE", cat: "Antibiotics", cost: 850, price: 1200, base: "pack", reorder: 25, conv: [["carton", 10]], batches: [["FID-A8801", 300, 90, 850], ["FID-A8802", 48, 60, 860]] },
    { name: "Ibuprofen 400mg Tablets", sku: "MED-IBU400", barcode: "5012345678902", dept: "PHARMACY", type: "MEDICINE", cat: "Analgesics & Antipyretics", cost: 300, price: 450, base: "pack", reorder: 30, batches: [["EMZ-I1201", 500, 140, 300], ["EMZ-I1202", 80, 90, 305]] },
    { name: "Coartem 20/120mg (AL)", sku: "MED-COA2012", barcode: "5012345678903", dept: "PHARMACY", type: "MEDICINE", cat: "Antimalarials", cost: 1800, price: 2500, base: "pack", reorder: 20, batches: [["FID-C7701", 380, 70, 1800], ["FID-C7702", 55, 45, 1820]] },
    { name: "Paracetamol Syrup 100ml", sku: "MED-PARSYR", barcode: "5012345678904", dept: "PHARMACY", type: "MEDICINE", cat: "Analgesics & Antipyretics", cost: 600, price: 900, base: "bottle", reorder: 24, batches: [["EMZ-PS3301", 240, 80, 600], ["EMZ-PS3302", 30, 40, 610]] },
    { name: "Vitamin C 100mg Tablets", sku: "MED-VITC100", barcode: "5012345678905", dept: "BOTH", type: "MEDICINE", cat: "Vitamins & Supplements", cost: 500, price: 800, base: "pack", reorder: 30, batches: [["FID-V5501", 600, 110, 500]] },
    { name: "Metronidazole 400mg Tablets", sku: "MED-MET400", barcode: "5012345678906", dept: "PHARMACY", type: "MEDICINE", cat: "Antibiotics", cost: 380, price: 550, base: "pack", reorder: 25, batches: [["EMZ-M9901", 350, 95, 380]] },
    { name: "ORS Sachet (WHO Formula)", sku: "MED-ORS20", barcode: "5012345678907", dept: "PHARMACY", type: "MEDICINE", cat: "First Aid", cost: 150, price: 250, base: "sachet", reorder: 50, batches: [["EMZ-O1101", 540, 240, 150]] },
    { name: "Hydrogen Peroxide 100ml", sku: "MED-H2O2", barcode: "5012345678908", dept: "PHARMACY", type: "MEDICINE", cat: "First Aid", cost: 450, price: 700, base: "bottle", reorder: 20, batches: [["FID-H2201", 400, 55, 450]] },
    { name: "Blood Glucose Test Strips (50s)", sku: "MED-GLUC50", barcode: "5012345678909", dept: "PHARMACY", type: "MEDICINE", cat: "First Aid", cost: 3200, price: 4500, base: "pack", reorder: 10, batches: [["FID-G6601", 330, 90, 3200]] },
    // Supermarket
    { name: "Golden Penny Spaghetti 500g", sku: "SUP-GPS500", barcode: "5001234000017", dept: "SUPERMARKET", type: "RETAIL", cat: "Food & Groceries", cost: 340, price: 450, base: "piece", reorder: 60, conv: [["carton", 20]] },
    { name: "Long Grain Rice 5kg", sku: "SUP-RICE5K", barcode: "5001234000024", dept: "SUPERMARKET", type: "RETAIL", cat: "Food & Groceries", cost: 6200, price: 7500, base: "bag", reorder: 15 },
    { name: "Cowbell Milk 400g Sachet", sku: "SUP-COW400", barcode: "5001234000031", dept: "SUPERMARKET", type: "RETAIL", cat: "Dairy", cost: 580, price: 750, base: "sachet", reorder: 80, conv: [["carton", 40]] },
    { name: "Coca-Cola 50cl PET", sku: "SUP-COKE50", barcode: "5001234000048", dept: "SUPERMARKET", type: "RETAIL", cat: "Beverages", cost: 210, price: 300, base: "bottle", reorder: 100, conv: [["carton", 12]] },
    { name: "Peak Milk Powder 400g Tin", sku: "SUP-PEAK400", barcode: "5001234000055", dept: "SUPERMARKET", type: "RETAIL", cat: "Dairy", cost: 2600, price: 3200, base: "tin", reorder: 24 },
    { name: "Indomie Instant Noodles 70g", sku: "SUP-IND70", barcode: "5001234000062", dept: "SUPERMARKET", type: "RETAIL", cat: "Food & Groceries", cost: 95, price: 130, base: "piece", reorder: 150, conv: [["carton", 40]] },
    { name: "Beko Cream Biscuits", sku: "SUP-BEKO", barcode: "5001234000079", dept: "SUPERMARKET", type: "RETAIL", cat: "Food & Groceries", cost: 130, price: 200, base: "piece", reorder: 100 },
    { name: "Grand Pa Laundry Soap 200g", sku: "SUP-GP200", barcode: "5001234000086", dept: "SUPERMARKET", type: "RETAIL", cat: "Household", cost: 320, price: 450, base: "piece", reorder: 60 },
    { name: "Power Oil 250ml", sku: "SUP-POW250", barcode: "5001234000093", dept: "SUPERMARKET", type: "RETAIL", cat: "Food & Groceries", cost: 420, price: 550, base: "bottle", reorder: 50, conv: [["carton", 24]] },
    { name: "Delta Soap 150g", sku: "SUP-DELTA150", barcode: "5001234000109", dept: "SUPERMARKET", type: "RETAIL", cat: "Personal Care", cost: 240, price: 350, base: "piece", reorder: 70 },
    { name: "Gino Tomato Paste 210g", sku: "SUP-GINO210", barcode: "5001234000116", dept: "SUPERMARKET", type: "RETAIL", cat: "Food & Groceries", cost: 280, price: 380, base: "piece", reorder: 80, conv: [["carton", 24]] },
    { name: "Close-Up Toothpaste 160g", sku: "SUP-CLOSEUP", barcode: "5001234000123", dept: "SUPERMARKET", type: "RETAIL", cat: "Personal Care", cost: 850, price: 1150, base: "piece", reorder: 40 },
  ];

  const productIds: { id: string; p: P }[] = [];
  for (const p of products) {
    const prod = await db.product.create({
      data: {
        businessId: business.id,
        name: p.name,
        sku: p.sku,
        description: `${p.name} — ${p.type === "MEDICINE" ? "pharmacy medicine" : "retail item"}`,
        categoryId: categories[`${p.dept === "BOTH" ? "PHARMACY" : p.dept}:${p.cat}`]?.id,
        department: p.dept,
        type: p.type,
        trackBatches: p.type === "MEDICINE",
        costPrice: d(p.cost),
        sellingPrice: d(p.price),
        baseUnit: p.base,
        reorderLevel: d(p.reorder),
        taxRate: d(0),
        isActive: true,
      },
    });
    await db.barcode.create({ data: { businessId: business.id, productId: prod.id, code: p.barcode } });
    if (p.conv) {
      for (const [unit, factor] of p.conv) {
        await db.unitConversion.create({ data: { productId: prod.id, fromUnit: unit, toUnit: p.base, factor: d(factor) } });
      }
    }
    productIds.push({ id: prod.id, p });
  }

  // ── Opening stock via goods receipts (30 days ago) ──────────────
  const receiver = storekeeper;
  await db.$transaction(async (tx) => {
    await receiveGoodsCore(tx, {
      businessId: business.id,
      supplierId: supEmzor.id,
      lines: productIds
        .filter(({ p }) => p.type === "MEDICINE" && p.batches)
        .flatMap(({ id, p }) =>
          p.batches!.filter(([, days, , ]) => days > 0).map(([batchNo, , qty, cost]) => ({
            productId: id,
            quantity: d(qty),
            unitCost: d(cost),
            batchNumber: batchNo,
            expiryDate: new Date(Date.now() + 0), // placeholder, fixed below
          }))
        )
        .map((line) => {
          const prod = productIds.find((x) => x.id === line.productId)!.p;
          const batch = prod.batches!.find((b) => b[0] === line.batchNumber)!;
          return { ...line, expiryDate: new Date(Date.now() + batch[1] * 864e5) };
        }),
      receivedById: receiver.id,
      notes: "Opening pharmaceutical stock (seeded)",
      onCredit: true,
      number: "GRN-000001",
    });
  });
  await db.$transaction(async (tx) => {
    await receiveGoodsCore(tx, {
      businessId: business.id,
      supplierId: supJustrite.id,
      lines: productIds
        .filter(({ p }) => p.type === "RETAIL")
        .map(({ id, p }) => ({ productId: id, quantity: d(Math.round(p.reorder * 6)), unitCost: d(p.cost) })),
      receivedById: receiver.id,
      notes: "Opening supermarket stock (seeded)",
      onCredit: true,
      number: "GRN-000002",
    });
  });

  // Legacy expired batch discovered in-store (created directly — receiving
  // rejects expired batches by design). Demonstrates expiry controls.
  for (const { id, p } of productIds.filter((x) => x.p.type === "MEDICINE")) {
    const expired = (p.batches ?? []).filter(([, days, qty]) => days <= 0 && qty > 0);
    for (const [batchNo, days, qty, cost] of expired) {
      const batch = await db.pharmacyBatch.create({
        data: {
          businessId: business.id,
          productId: id,
          supplierId: supEmzor.id,
          batchNumber: batchNo,
          expiryDate: new Date(Date.now() + days * 864e5),
          quantityReceived: d(qty),
          quantityRemaining: d(qty), // manual OPENING movement below mirrors this
          unitCost: d(cost),
          status: "EXPIRED",
        },
      });
      await db.stockMovement.create({
        data: {
          businessId: business.id,
          productId: id,
          batchId: batch.id,
          type: "OPENING",
          quantity: d(qty),
          unitCost: d(cost),
          reason: "Legacy stock (found expired in store)",
        },
      });
      // Balance includes it; batch is blocked from sale by status
      await db.stockBalance.upsert({
        where: { productId: id },
        create: { businessId: business.id, productId: id, quantity: d(qty) },
        update: { quantity: { increment: d(qty) } },
      });
    }
  }

  // ── 30 days of sales history ────────────────────────────────────
  // Plan all random draws sequentially (deterministic), then execute each
  // day's sales with a small concurrency pool — seeding over a WAN database
  // would otherwise take 15+ minutes of pure round-trip latency.
  const medicines = productIds.filter(({ p }) => p.type === "MEDICINE" && !p.batches!.every(([, , q]) => q <= 0));
  const retail = productIds.filter(({ p }) => p.type === "RETAIL");
  const allProducts = await db.product.findMany({ where: { businessId: business.id }, select: { id: true, sellingPrice: true } });
  const priceOf = new Map(allProducts.map((p) => [p.id, d(p.sellingPrice)]));
  let saleCounter = 0;

  type SalePlan = {
    lines: { productId: string; quantity: Prisma.Decimal.Value; soldUnit: string }[];
    payments: { method: "CASH" | "TRANSFER" | "CARD"; amount: Prisma.Decimal.Value; reference?: string }[];
    createdAt: Date;
    idempotencyKey: string;
  };
  const dayPlans: { day: Date; dayOffset: number; sales: SalePlan[]; discrepancy: Prisma.Decimal }[] = [];

  for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
    const day = new Date(Date.now() - dayOffset * 864e5);
    day.setHours(9, 0, 0, 0);
    const isSunday = day.getDay() === 0;
    const salesCount = isSunday ? 2 + Math.floor(rand() * 2) : 4 + Math.floor(rand() * 5);
    const sales: SalePlan[] = [];

    for (let s = 0; s < salesCount; s++) {
      const itemCount = 1 + Math.floor(rand() * 4);
      const lines: { productId: string; quantity: Prisma.Decimal.Value; soldUnit: string }[] = [];
      const used = new Set<string>();
      for (let i = 0; i < itemCount; i++) {
        const pool = rand() < 0.4 ? medicines : retail;
        const chosen = pick(pool);
        if (used.has(chosen.id)) continue;
        used.add(chosen.id);
        const q = 1 + Math.floor(rand() * (chosen.p.type === "MEDICINE" ? 3 : 4));
        lines.push({ productId: chosen.id, quantity: d(q), soldUnit: chosen.p.base });
      }
      if (!lines.length) continue;

      const roll = rand();
      const payments: { method: "CASH" | "TRANSFER" | "CARD"; amount: Prisma.Decimal.Value; reference?: string }[] = [];
      // Amount computed from seeded DB prices; cash paid generously to avoid underpayment.
      const total = lines.reduce((acc, l) => acc.add(priceOf.get(l.productId)!.mul(d(l.quantity))), new Prisma.Decimal(0));

      if (roll < 0.62) {
        payments.push({ method: "CASH", amount: total.add(Math.floor(rand() * 3) * 50) });
      } else if (roll < 0.85) {
        payments.push({ method: "TRANSFER", amount: total, reference: `TRF-d${dayOffset}-s${s}` });
      } else if (roll < 0.95) {
        payments.push({ method: "CARD", amount: total, reference: `POS-d${dayOffset}-s${s}` });
      } else {
        // split tender
        const cashPart = total.mul(0.4).toDecimalPlaces(0);
        payments.push({ method: "CASH", amount: cashPart });
        payments.push({ method: "TRANSFER", amount: total.minus(cashPart), reference: `TRF-d${dayOffset}-s${s}` });
      }

      // Keep today's sales in the past: spread 09:00→12:40 for day 0,
      // otherwise spread through the day (9:00 → 19:40)
      const hourOffset = dayOffset === 0 ? Math.floor(s * 0.5) : s;
      const minuteOffset = dayOffset === 0 ? (s % 2) * 40 : (s * 17) % 60;
      const createdAt = new Date(day.getTime() + hourOffset * 36e5 + minuteOffset * 6e4);
      saleCounter++;
      sales.push({
        lines,
        payments,
        createdAt,
        idempotencyKey: `seed-sale-${saleCounter}-${business.id.slice(-6)}`,
      });
    }

    const discrepancy = rand() < 0.12 ? d(rand() < 0.5 ? -50 : 50) : d(0);
    dayPlans.push({ day, dayOffset, sales, discrepancy });
  }

  // Execute: shift open/close sequential per day, sales in parallel batches.
  for (const dp of dayPlans) {
    const shift = await db.cashierShift.create({
      data: {
        businessId: business.id,
        userId: cashier.id,
        status: dp.dayOffset === 0 ? "OPEN" : "CLOSED",
        openedAt: dp.day,
        openingCash: d(5000),
      },
    });
    await db.cashMovement.create({
      data: { businessId: business.id, shiftId: shift.id, type: "OPENING", amount: d(5000), userId: cashier.id, reason: "Opening float" },
    });

    const CONCURRENCY = 5;
    for (let i = 0; i < dp.sales.length; i += CONCURRENCY) {
      const chunk = dp.sales.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (plan) => {
          // Retry: parallel sales race on nextDocNumber (read-max-then-increment).
          // A loser fails with a unique violation; by retry time the winner has
          // committed, so the re-read advances and the retry succeeds. Real stock
          // errors (INSUFFICIENT_STOCK etc.) also land here — capped attempts
          // keep those as skips without looping forever.
          for (let attempt = 1; attempt <= 5; attempt++) {
            try {
              await db.$transaction(async (tx) => {
                const res = await createSaleCore(tx, {
                  businessId: business.id,
                  cashierId: cashier.id,
                  shiftId: shift.id,
                  lines: plan.lines,
                  payments: plan.payments,
                  idempotencyKey: plan.idempotencyKey,
                  channel: "ONLINE",
                  clientCreatedAt: plan.createdAt,
                });
                // Backdate the sale to its day (same tx — no race on number lookup)
                await tx.sale.update({ where: { id: res.saleId }, data: { createdAt: plan.createdAt, clientCreatedAt: plan.createdAt } });
              });
              return; // success
            } catch (err) {
              const msg = (err as Error).message.slice(0, 80);
              if (attempt === 5) {
                // Stock exhausted for a picked item (or persistent conflict) — skip
                console.warn(`  skip sale [${plan.idempotencyKey}] (${msg})`);
              } else if (!/Unique constraint|INSUFFICIENT_STOCK|Stock/i.test(msg)) {
                // Non-retryable service error — skip immediately
                console.warn(`  skip sale [${plan.idempotencyKey}] (${msg})`);
                return;
              }
              // brief stagger before retry so competing writers diverge
              await new Promise((r) => setTimeout(r, 50 * attempt + Math.floor(Math.random() * 40)));
            }
          }
        })
      );
    }

    if (dp.dayOffset > 0) {
      // Close the day's shift with reconciliation
      const cashAgg = await db.cashMovement.aggregate({ where: { shiftId: shift.id, type: { in: ["OPENING", "SALE", "REFUND", "DROP", "PAYOUT"] } }, _sum: { amount: true } });
      const expected = d(cashAgg._sum.amount ?? 0);
      const salesAgg = await db.sale.aggregate({ where: { shiftId: shift.id, status: "COMPLETED" }, _sum: { total: true }, _count: true });
      await db.cashierShift.update({
        where: { id: shift.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(dp.day.getTime() + 20 * 36e5),
          expectedCash: expected,
          countedCash: expected.add(dp.discrepancy),
          discrepancy: dp.discrepancy,
          totalsJson: JSON.stringify({ salesCount: salesAgg._count, salesTotal: (salesAgg._sum.total ?? 0).toString() }),
        },
      });
    }
  }

  // ── Expense categories & sample expenses ────────────────────────
  const expCats: Record<string, string> = {};
  for (const name of ["Rent", "Electricity & Utilities", "Salaries & Wages", "Transport & Logistics", "Internet & Airtime", "Maintenance", "Marketing", "Miscellaneous"]) {
    const c = await db.expenseCategory.create({ data: { businessId: business.id, name } });
    expCats[name] = c.id;
  }
  const expenses: [string, number, number, string, string][] = [
    ["Rent", 150000, 30, "CASH", "Monthly shop rent — Osogbo premises"],
    ["Salaries & Wages", 385000, 28, "TRANSFER", "Staff salaries — previous month"],
    ["Electricity & Utilities", 32000, 14, "CASH", "IKEDC prepaid + generator diesel"],
    ["Internet & Airtime", 18000, 7, "TRANSFER", "Fibre subscription + data bundles"],
    ["Transport & Logistics", 14500, 3, "CASH", "Supplier pickup — Ibadan run"],
    ["Maintenance", 22500, 2, "CASH", "Deep freezer repair + POS terminal service"],
  ];
  for (const [cat, amount, daysAgo, method, desc] of expenses) {
    await db.expense.create({
      data: {
        businessId: business.id,
        categoryId: expCats[cat],
        amount: d(amount),
        date: new Date(Date.now() - daysAgo * 864e5),
        paymentMethod: method,
        description: desc,
        status: "APPROVED",
        enteredById: accountant.id,
      },
    });
  }

  // ── Supplier product links ──────────────────────────────────────
  for (const { id, p } of productIds) {
    const supplierId = p.type === "MEDICINE" ? (rand() < 0.5 ? supEmzor.id : supFidson.id) : rand() < 0.5 ? supJustrite.id : supUnilever.id;
    await db.supplierProduct.upsert({
      where: { supplierId_productId: { supplierId, productId: id } },
      update: {},
      create: { supplierId, productId: id, lastCost: d(p.cost) },
    });
  }

  // ── Welcome notification ────────────────────────────────────────
  await db.notification.create({
    data: {
      businessId: business.id,
      type: "SYSTEM",
      title: "Welcome to SynkiSell",
      body: "Your workspace is live. Review expiring batches in Inventory → Expiry watch.",
      severity: "INFO",
    },
  });

  console.log(`Seed complete: ${saleCounter} sales across 30 days, ${productIds.length} products.`);
  console.log("Demo accounts:");
  console.log("  admin@synkisell.com / SynkiAdmin#2026   (platform admin)");
  console.log("  owner@firstpharmplus.ng / Owner#2026    (business owner)");
  console.log("  manager@firstpharmplus.ng / Manager#2026 (manager)");
  console.log("  cashier@firstpharmplus.ng / Cashier#2026 (cashier)");
  console.log("  store@firstpharmplus.ng / Store#2026    (inventory)");
  console.log("  pharmacist@firstpharmplus.ng / Pharma#2026 (pharmacist)");
  console.log("  accounts@firstpharmplus.ng / Accounts#2026 (accountant)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
