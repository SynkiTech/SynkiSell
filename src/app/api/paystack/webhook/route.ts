import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { paystackVerify } from "@/server/billing/paystack";

/**
 * Paystack webhook receiver.
 * - Signature verified per official docs (HMAC-SHA512 over raw body).
 * - Event id recorded (unique per provider) → IDEMPOTENT processing:
 *   duplicate events are acknowledged but never re-applied.
 * - Only charge.success with server-side verification activates invoices.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  const { verifyWebhookSignature } = await import("@/server/billing/paystack");
  const valid = verifyWebhookSignature(rawBody, signature);

  let event: { event?: string; data?: { reference?: string; id?: number | string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const eventId = `${event.event}:${event.data?.id ?? event.data?.reference ?? "unknown"}`;

  const record = await db.webhookEvent.upsert({
    where: { provider_eventId: { provider: "PAYSTACK", eventId } },
    create: {
      provider: "PAYSTACK",
      eventId,
      eventType: event.event ?? "unknown",
      payloadJson: rawBody.slice(0, 8000),
      status: "RECEIVED",
    },
    update: {},
  });

  if (!valid) {
    await db.webhookEvent.update({ where: { id: record.id }, data: { status: "SKIPPED", error: "invalid signature" } });
    // Acknowledge to prevent retries, but do nothing
    return NextResponse.json({ ok: false, reason: "invalid signature" }, { status: 200 });
  }

  if (record.status === "PROCESSED") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    if (event.event === "charge.success" && event.data?.reference) {
      // Never trust the webhook payload's amount/status: verify with the API
      const verification = await paystackVerify(event.data.reference);
      if (verification.status === "SUCCESS") {
        const { applyVerifiedPayment } = await import("@/server/billing/apply-payment");
        await applyVerifiedPayment(event.data.reference, "PAYSTACK_WEBHOOK");
      }
    }
    await db.webhookEvent.update({ where: { id: record.id }, data: { status: "PROCESSED", processedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "processing error";
    await db.webhookEvent.update({ where: { id: record.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
