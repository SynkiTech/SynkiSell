import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

/**
 * Paystack integration boundary.
 *
 * Real HTTP calls (initialize / verify) happen ONLY when
 * PAYSTACK_SECRET_KEY is configured. Otherwise the module operates in
 * MOCK TEST MODE which is always explicitly labelled as such — mock
 * operations are never represented as real provider transactions.
 *
 * Server-side verification is the ONLY path that flips payment/subscription
 * state. Browser redirects and success pages never activate anything.
 */

export function paystackConfigured(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY;
}

export function paystackMode(): "LIVE_KEYS" | "MOCK_TEST_MODE" {
  return paystackConfigured() ? "LIVE_KEYS" : "MOCK_TEST_MODE";
}

export type InitResult = {
  mode: "LIVE_KEYS" | "MOCK_TEST_MODE";
  reference: string;
  authorizationUrl: string | null; // null in mock mode
  accessCode: string | null;
};

/** Initialize a transaction for an invoice. Creates a PENDING PaymentTransaction. */
export async function paystackInitialize(input: {
  businessId: string;
  invoiceId: string;
  email: string;
  amountKobo: number;
  metadata?: Record<string, unknown>;
}): Promise<InitResult> {
  const reference = `SKS-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  await db.paymentTransaction.create({
    data: {
      businessId: input.businessId,
      invoiceId: input.invoiceId,
      provider: "PAYSTACK",
      reference,
      method: "ONLINE",
      amount: (input.amountKobo / 100).toFixed(2),
      status: "PENDING",
      purpose: "CUSTOM",
      channelJson: JSON.stringify({ initializedAt: new Date().toISOString(), mode: paystackMode() }),
    },
  });

  if (!paystackConfigured()) {
    // MOCK TEST MODE: no external call; the UI explains the simulation and
    // calls paystackMockConfirm (admin-gated) to simulate a verified payment.
    return { mode: "MOCK_TEST_MODE", reference, authorizationUrl: null, accessCode: null };
  }

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      amount: input.amountKobo,
      reference,
      metadata: input.metadata ?? {},
    }),
  });
  const json = (await res.json()) as { status: boolean; message?: string; data?: { authorization_url: string; access_code: string } };
  if (!json.status || !json.data) {
    throw new Error(`Paystack initialize failed: ${json.message ?? "unknown error"}`);
  }
  return { mode: "LIVE_KEYS", reference, authorizationUrl: json.data.authorization_url, accessCode: json.data.access_code };
}

export type VerifyResult = {
  status: "SUCCESS" | "FAILED" | "PENDING";
  amount: number; // major units
  reference: string;
  mode: "LIVE_KEYS" | "MOCK_TEST_MODE";
  paidAt: string | null;
};

/** Verify a transaction server-side (the authoritative check). */
export async function paystackVerify(reference: string): Promise<VerifyResult> {
  if (!paystackConfigured()) {
    const tx = await db.paymentTransaction.findUnique({ where: { reference } });
    if (!tx) throw new Error("Unknown payment reference.");
    if (tx.status === "SUCCESS") {
      return { status: "SUCCESS", amount: Number(tx.amount), reference, mode: "MOCK_TEST_MODE", paidAt: (tx.verifiedAt ?? tx.createdAt).toISOString() };
    }
    return { status: "PENDING", amount: Number(tx.amount), reference, mode: "MOCK_TEST_MODE", paidAt: null };
  }

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  const json = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: { status: string; amount: number; paid_at?: string };
  };
  if (!json.status || !json.data) {
    throw new Error(`Paystack verify failed: ${json.message ?? "unknown error"}`);
  }
  return {
    status: json.data.status === "success" ? "SUCCESS" : json.data.status === "failed" ? "FAILED" : "PENDING",
    amount: json.data.amount / 100,
    reference,
    mode: "LIVE_KEYS",
    paidAt: json.data.paid_at ?? null,
  };
}

/** Verify Paystack webhook signature per official docs (HMAC-SHA512 of body with secret key). */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (!secret) return false;
  const hash = createHmac("sha512", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}
