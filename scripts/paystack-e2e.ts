/**
 * Paystack LIVE_KEYS integration verification (server-side, no HTTP layer).
 *
 * Exercises the exact modules the billing UI uses:
 *   1. paystackMode()            -> must be LIVE_KEYS now that the key is set
 *   2. paystackInitialize()      -> creates PENDING PaymentTransaction AND
 *                                   calls the REAL api.paystack.co initialize
 *   3. paystackVerify()          -> server-side verify against api.paystack.co
 *                                   (expected PENDING — no card charged)
 *   4. verifyWebhookSignature()  -> HMAC-SHA512 webhook signature gate
 *
 * Cleans up the probe transaction afterwards so the billing view stays clean.
 */
import { createHmac } from "crypto";
import { db } from "@/lib/db";
import {
  paystackMode,
  paystackInitialize,
  paystackVerify,
  verifyWebhookSignature,
} from "@/server/billing/paystack";

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}: ${detail}`);
}

const key = process.env.PAYSTACK_SECRET_KEY ?? "";

async function main() {
  // 1. Mode switch
  const mode = paystackMode();
  record("mode", mode === "LIVE_KEYS", `paystackMode() = ${mode}`);

  // 2. Find an unpaid invoice, or create a throwaway probe invoice (all seeded
  //    invoices in the demo business are already PAID).
  let invoice = await db.invoice.findFirst({
    where: { status: { in: ["DRAFT", "ISSUED"] } },
    orderBy: { createdAt: "desc" },
    include: { business: { select: { id: true, name: true } } },
  });
  let createdInvoiceId: string | null = null;
  if (!invoice) {
    const business = await db.business.findFirst({ select: { id: true, name: true } });
    if (!business) throw new Error("No business found for the probe.");
    invoice = await db.invoice.create({
      data: {
        businessId: business.id,
        number: `SKS-PROBE-${Date.now()}`,
        kind: "CUSTOM",
        status: "ISSUED",
        subtotal: 1500,
        total: 1500,
        issuedAt: new Date(),
        notes: "Temporary probe invoice — deleted by scripts/paystack-e2e.ts",
        lines: { create: { kind: "OTHER", description: "Paystack integration probe", unitAmount: 1500, amount: 1500 } },
      },
      include: { business: { select: { id: true, name: true } } },
    });
    createdInvoiceId = invoice.id;
    console.log("Created temporary probe invoice (will be removed).");
  }
  const owner = await db.user.findFirst({ where: { platformAdmin: false }, select: { email: true } });
  console.log(`Probe invoice: ${invoice.number} (total ${invoice.total}) for ${invoice.business.name}`);

  // 3. Initialize — REAL Paystack API call
  let reference = "";
  let authorizationUrl = "";
  try {
    const init = await paystackInitialize({
      businessId: invoice.businessId,
      invoiceId: invoice.id,
      email: owner?.email ?? "owner@firstpharmplus.ng",
      amountKobo: Math.round(Number(invoice.total) * 100),
      metadata: { probe: true, invoiceNumber: invoice.number },
    });
    reference = init.reference;
    authorizationUrl = init.authorizationUrl ?? "";
    record(
      "initialize",
      init.mode === "LIVE_KEYS" && /^https:\/\/checkout\.paystack\.com\//.test(authorizationUrl),
      `mode=${init.mode}, ref=${reference}, authorizationUrl=${authorizationUrl || "(none)"}`
    );
  } catch (e) {
    record("initialize", false, e instanceof Error ? e.message : String(e));
  }

  // 4. Verify — server-side (expected PENDING; proves the verify API path works)
  if (reference) {
    try {
      const v = await paystackVerify(reference);
      record(
        "verify",
        v.mode === "LIVE_KEYS" && v.status === "PENDING" && v.amount === Number(invoice.total),
        `status=${v.status}, amount=${v.amount}, mode=${v.mode}`
      );
    } catch (e) {
      record("verify", false, e instanceof Error ? e.message : String(e));
    }
  }

  // 5. Webhook signature gate
  const payload = JSON.stringify({ event: "charge.success", data: { reference } });
  const goodSig = createHmac("sha512", key).update(payload).digest("hex");
  record("webhook-sig-valid", verifyWebhookSignature(payload, goodSig) === true, "correct HMAC-SHA512 accepted");
  record(
    "webhook-sig-invalid",
    verifyWebhookSignature(payload, goodSig.replace(/./, "0")) === false,
    "tampered signature rejected"
  );

  // 6. Cleanup probe transaction + probe invoice
  if (reference) {
    const del = await db.paymentTransaction.deleteMany({ where: { reference } });
    record("cleanup", del.count === 1, `removed ${del.count} probe PaymentTransaction(s)`);
  }
  if (createdInvoiceId) {
    const inv = await db.invoice.delete({ where: { id: createdInvoiceId } }).catch(() => null);
    console.log(inv ? "Probe invoice removed." : "Probe invoice cleanup skipped (lines cascade).");
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\nRESULT: ${results.length - failed}/${results.length} checks passed`);
  await db.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
