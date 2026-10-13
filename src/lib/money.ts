import { Prisma } from "@prisma/client";

/**
 * Money & quantity helpers — ALL arithmetic uses Prisma.Decimal (decimal.js).
 * Never use JS numbers for money.
 */

export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;

export const ZERO = new D(0);

export function dec(value: Prisma.Decimal.Value | null | undefined): Dec {
  return new D(value ?? 0);
}

/** Round to 2 dp (money), half-up. */
export function money(value: Dec | Prisma.Decimal.Value): Dec {
  return dec(value).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

/** Round to 4 dp (quantities), half-up. */
export function qty(value: Dec | Prisma.Decimal.Value): Dec {
  return dec(value).toDecimalPlaces(4, D.ROUND_HALF_UP);
}

/** Format NGN for display: ₦12,345.50 */
export function formatNaira(value: Dec | Prisma.Decimal.Value | number | string): string {
  const n = dec(value).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const sign = n.isNegative() ? "-" : "";
  const [intPart, decPart] = n.abs().toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₦${grouped}.${decPart}`;
}

/** Format quantity for display (trim trailing zeros). */
export function formatQty(value: Dec | Prisma.Decimal.Value | number | string): string {
  const q = dec(value).toDecimalPlaces(4, D.ROUND_HALF_UP);
  return q.toFixed(4).replace(/\.?0+$/, "") || "0";
}

/**
 * Compute line total for a sale line:
 * lineTotal = (qty × unitPrice − discount) + tax(taxRate% of net)
 */
export function computeLine(input: {
  quantity: Dec | Prisma.Decimal.Value;
  unitPrice: Dec | Prisma.Decimal.Value;
  discount?: Dec | Prisma.Decimal.Value;
  taxRatePct?: Dec | Prisma.Decimal.Value;
}): { net: Dec; tax: Dec; total: Dec } {
  const gross = qty(input.quantity).mul(dec(input.unitPrice));
  const net = gross.minus(dec(input.discount ?? 0));
  const tax = money(net.mul(dec(input.taxRatePct ?? 0)).div(100));
  return { net: money(net), tax, total: money(net.add(tax)) };
}

/** Sum a list of decimals safely. */
export function sum(values: (Dec | Prisma.Decimal.Value | null | undefined)[]): Dec {
  return values.reduce<Dec>((acc, v) => acc.add(dec(v)), ZERO);
}
