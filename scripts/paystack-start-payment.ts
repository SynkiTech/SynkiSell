/**
 * Paystack FULL-LIFECYCLE test — step 1: start a payment.
 * Creates a probe invoice, initializes a REAL Paystack transaction,
 * and writes { reference, authorizationUrl } to .paystack-probe.json.
 * Step 2 (browser) completes the payment on the hosted page.
 * Step 3 (paystack-apply-payment.ts) verifies + applies + cleans up.
 */
import { writeFileSync } from "fs";
import { db } from "@/lib/db";
import { paystackMode, paystackInitialize } from "@/server/billing/paystack";

async function main() {
  console.log(`mode: ${paystackMode()}`);
  const business = await db.business.findFirstOrThrow({ select: { id: true, name: true } });
  const owner = await db.user.findFirstOrThrow({
    where: { platformAdmin: false },
    select: { email: true },
  });

  const invoice = await db.invoice.create({
    data: {
      businessId: business.id,
      number: `SKS-PROBE-${Date.now()}`,
      kind: "CUSTOM",
      status: "ISSUED",
      subtotal: 1500,
      total: 1500,
      issuedAt: new Date(),
      notes: "Temporary probe invoice — deleted by paystack-apply-payment.ts",
      lines: { create: { kind: "OTHER", description: "Paystack end-to-end payment test", unitAmount: 1500, amount: 1500 } },
    },
  });
  console.log(`probe invoice: ${invoice.number} (₦${invoice.total}) for ${business.name}`);

  const init = await paystackInitialize({
    businessId: business.id,
    invoiceId: invoice.id,
    email: owner.email,
    amountKobo: Math.round(Number(invoice.total) * 100),
    metadata: { probe: "e2e", invoiceNumber: invoice.number },
  });

  if (init.mode !== "LIVE_KEYS" || !init.authorizationUrl) {
    throw new Error(`Unexpected init result: ${JSON.stringify(init)}`);
  }

  writeFileSync(
    "/home/z/my-project/scripts/.paystack-probe.json",
    JSON.stringify({ reference: init.reference, authorizationUrl: init.authorizationUrl, invoiceId: invoice.id }, null, 2)
  );
  console.log(`reference:        ${init.reference}`);
  console.log(`authorizationUrl: ${init.authorizationUrl}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("START ERROR:", e);
  process.exit(1);
});
