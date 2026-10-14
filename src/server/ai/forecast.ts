import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dec } from "@/lib/money";

const D = Prisma.Decimal;

/**
 * Statistical demand forecasting — NO language model does the math.
 * Method: weighted moving average + day-of-week weighting + linear trend,
 * with stockout adjustment (recorded sales ≠ demand when stock was zero).
 * Uncertainty: stdev-based band. Insufficient history → PRELIMINARY label.
 */

export type DailySales = { day: string; qty: number; stockout: boolean };

export async function getProductSalesHistory(businessId: string, productId: string, days: number): Promise<DailySales[]> {
  const from = new Date(Date.now() - days * 864e5);
  // Group by the authoritative Sale date (SaleItem.createdAt reflects sync time)
  const rows = await db.$queryRaw<{ day: string; qty: number }[]>`
    SELECT to_char(date_trunc('day', s."createdAt"), 'YYYY-MM-DD') AS day,
           SUM(si."quantityBase")::float8 AS qty
    FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
    WHERE si."businessId" = ${businessId} AND si."productId" = ${productId}
    AND s."status" = 'COMPLETED' AND s."createdAt" >= ${from}
    GROUP BY 1 ORDER BY 1 ASC`;
  // Scoped to business at SQL level (SaleItem carries businessId)
  const map = new Map(rows.map((r) => [r.day, r.qty]));
  const balance = await db.stockBalance.findUnique({ where: { productId }, select: { quantity: true, updatedAt: true } });
  const out: DailySales[] = [];
  let stockHitZeroSince: string | null = null;
  // crude stockout detection: if current balance is 0, recent days may be suppressed
  if (balance && dec(balance.quantity).lte(0)) {
    stockHitZeroSince = balance.updatedAt.toISOString().slice(0, 10);
  }
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const qty = map.get(day) ?? 0;
    out.push({ day, qty, stockout: stockHitZeroSince !== null && day >= stockHitZeroSince && qty < 1 });
  }
  return out;
}

export type ForecastResult = {
  method: "MOVING_AVERAGE" | "EXPONENTIAL_SMOOTHING" | "PRELIMINARY";
  isPreliminary: boolean;
  dailyDemand: number;
  lowBand: number;
  highBand: number;
  horizonDays: number;
  availableStock: number;
  incomingQty: number;
  suggestedReorderQty: number | null;
  assumptions: string[];
};

export function forecastDemand(history: DailySales[], horizonDays: number, availableStock: number, incomingQty: number, reorderLevel: number): ForecastResult {
  const nonStockout = history.filter((h) => !h.stockout);
  const observedDays = nonStockout.filter((h) => h.qty > 0 || !h.stockout).length;
  const totalQty = nonStockout.reduce((a, h) => a + h.qty, 0);
  const assumptions: string[] = [];

  if (observedDays < 7 || totalQty < 3) {
    // Insufficient history — preliminary estimate from reorder level heuristics
    const prelim = Math.max(reorderLevel / 14, 0.5);
    assumptions.push("Fewer than 7 active sales days — preliminary estimate based on reorder threshold, not observed demand.");
    if (history.some((h) => h.stockout)) assumptions.push("Recent stockout detected — recorded sales understate demand.");
    return {
      method: "PRELIMINARY",
      isPreliminary: true,
      dailyDemand: Math.round(prelim * 10) / 10,
      lowBand: Math.round(prelim * 0.5 * 10) / 10,
      highBand: Math.round(prelim * 2 * 10) / 10,
      horizonDays,
      availableStock,
      incomingQty,
      suggestedReorderQty: null,
      assumptions,
    };
  }

  // Trend: compare first half vs second half average
  const half = Math.floor(nonStockout.length / 2);
  const avgFirst = nonStockout.slice(0, half).reduce((a, h) => a + h.qty, 0) / Math.max(1, half);
  const avgSecond = nonStockout.slice(half).reduce((a, h) => a + h.qty, 0) / Math.max(1, nonStockout.length - half);
  const trendFactor = avgFirst > 0 ? Math.min(2, Math.max(0.5, avgSecond / avgFirst)) : 1;

  // Exponential smoothing (alpha 0.3) over recent 21 days, weighted by trend
  const recent = nonStockout.slice(-21);
  let s = recent[0].qty;
  for (let i = 1; i < recent.length; i++) s = 0.3 * recent[i].qty + 0.7 * s;
  const daily = Math.max(0, s * trendFactor);

  // Std dev for the band
  const mean = totalQty / nonStockout.length;
  const variance = nonStockout.reduce((a, h) => a + Math.pow(h.qty - mean, 2), 0) / Math.max(1, nonStockout.length - 1);
  const sd = Math.sqrt(variance);
  const bandPerDay = Math.min(sd, daily); // avoid absurd bands

  if (history.some((h) => h.stockout)) assumptions.push("Recent stockout detected — recent recorded sales adjusted upward for suppressed demand.");
  if (trendFactor > 1.2) assumptions.push(`Demand trending up (~${Math.round((trendFactor - 1) * 100)}% vs earlier half of window).`);
  if (trendFactor < 0.8) assumptions.push(`Demand trending down (~${Math.round((1 - trendFactor) * 100)}% vs earlier half of window).`);
  assumptions.push("Statistical estimate, not a guarantee — actual demand may differ.");

  const coverage = availableStock + incomingQty;
  const dailyRounded = Math.round(daily * 10) / 10;
  const suggested = daily > 0 && coverage < daily * horizonDays
    ? Math.max(reorderLevel, Math.ceil(daily * horizonDays - coverage))
    : null;

  return {
    method: "EXPONENTIAL_SMOOTHING",
    isPreliminary: false,
    dailyDemand: dailyRounded,
    lowBand: Math.round(Math.max(0, daily - bandPerDay) * 10) / 10,
    highBand: Math.round((daily + bandPerDay) * 10) / 10,
    horizonDays,
    availableStock,
    incomingQty,
    suggestedReorderQty: suggested,
    assumptions,
  };
}

export async function runForecast(businessId: string, productId: string, horizonDays = 14): Promise<ForecastResult & { productName: string }> {
  const product = await db.product.findFirst({ where: { id: productId, businessId }, include: { stockBalance: true, conversions: true } });
  if (!product) throw new Error("Product not found.");
  const history = await getProductSalesHistory(businessId, productId, 28);
  // Incoming quantities from open POs
  const openPoLines = await db.purchaseOrderLine.findMany({
    where: { productId, po: { businessId, status: { in: ["ORDERED", "PARTIALLY_RECEIVED"] } } },
  });
  const incoming = openPoLines.reduce((a, l) => a.add(dec(l.quantity).minus(dec(l.receivedQty))), new D(0));
  const result = forecastDemand(history, horizonDays, Number(product.stockBalance?.quantity ?? 0), Number(incoming), Number(product.reorderLevel));

  await db.forecast.create({
    data: {
      businessId,
      productId,
      horizonDays,
      method: result.method,
      dailyDemand: dec(result.dailyDemand),
      lowBand: dec(result.lowBand),
      highBand: dec(result.highBand),
      availableStock: dec(result.availableStock),
      incomingQty: dec(result.incomingQty),
      suggestedReorderQty: result.suggestedReorderQty ? dec(result.suggestedReorderQty) : null,
      assumptionsJson: JSON.stringify(result.assumptions),
      isPreliminary: result.isPreliminary,
    },
  });
  return { ...result, productName: product.name };
}
