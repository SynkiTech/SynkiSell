/**
 * Paystack FULL-LIFECYCLE test — step 3: verify + apply + cleanup.
 *
 * In normal operation (user pays on the hosted page), this is the flow the
 * app runs automatically: paystackVerify(reference) -> SUCCESS ->
 * applyVerifiedPayment(reference, "VERIFY_API") -> invoice PAID.
 *
 * The Cloudflare challenge on checkout.paystack.com cannot be passed from a
 * headless sandbox browser, so automated completion of the card payment is
 * not possible here. This script therefore:
 *   1. Re-verifies the reference against the live Paystack API (documents
 *      that it remains PENDING — correct: no payment was made).
 *   2. Cleans up the probe invoice + transaction so the billing view and
 *      the Paystack test dashboard stay unpolluted.
 */
import { readFileSync } from "fs";
import { db } from "@/lib/db";
import { paystackVerify } from "@/server/billing/paystack";
import { applyVerifiedPayment } from "@/server/billing/apply-payment";

async function main() {
  const probe = JSON.parse(readFileSync("/home/z/my-project/scripts/.paystack-probe.json", "utf8"));
  console.log(`reference: ${probe.reference}`);

  const verification = await paystackVerify(probe.reference);
  console.log(`verify: status=${verification.status}, amount=${verification.amount}, mode=${verification.mode}`);

  if (verification.status === "SUCCESS") {
    const applied = await applyVerifiedPayment(probe.reference, "VERIFY_API");
    console.log(`applied: ${JSON.stringify(applied)} (payment verified by Paystack — state flipped)`);
  } else {
    console.log("Payment not completed (expected — hosted page requires a human). State correctly NOT applied.");
  }

  // Cleanup probe records
  const delTx = await db.paymentTransaction.deleteMany({ where: { reference: probe.reference } });
  const delInv = await db.invoice.deleteMany({ where: { id: probe.invoiceId } }).catch(() => ({ count: 0 }));
  console.log(`cleanup: ${delTx.count} transaction(s), ${delInv.count} invoice(s) removed`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("APPLY ERROR:", e);
  process.exit(1);
});
