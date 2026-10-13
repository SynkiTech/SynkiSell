# SynkiSell — Database Design

## Tenancy model

- `User` — identity only (auth, profile, platform flag). Never tenant-scoped.
- `Business` — the tenant. Every tenant-owned table carries `businessId` FK.
- `Membership` — user↔business with role + extra permission overrides;
  composite unique `(userId, businessId)`; deactivated memberships block
  session context.
- All tenant queries are scoped by the `businessId` resolved server-side from
  the session (see docs/SECURITY.md). The schema additionally enforces
  same-tenant integrity on the hottest child tables via composite unique
  keys (e.g. `Product` unique `(businessId, sku)`, `Sale` unique
  `(businessId, number)`, `Sale.idempotencyKey` globally unique).

## Money, quantities, time

- Money: `Decimal` columns (Prisma Decimal = decimal.js; no floats).
- Quantities: `Decimal` (fractional units allowed for weighed goods).
- Timestamps: UTC in DB (`DateTime`); rendered in the business timezone
  (default `Africa/Lagos`).
- Numbers that must never drift (sale totals) are snapshotted on the record.

## Stock model

- `StockMovement` = append-only ledger: signed `quantity` in **base units**,
  type (purchase_receipt, sale, sale_cancel, return_in, return_out,
  adjustment_in, adjustment_out, damage, supplier_return, opening), reason,
  reference (sale/refund/PO/receipt/adjustment ids), actor.
- `StockBalance` = cached projection per (business, product); every movement
  updates it inside the same transaction; reconcilable by aggregation.
- `PharmacyBatch` = per-batch quantity, cost, expiry; sale lines store their
  FEFO allocation snapshot (JSON) so historical sales remain explainable.
- Unit conversions: `UnitConversion` rows per product (from→to × factor),
  validated on write; movements and balances live in base units.

## Entity groups

**Identity & access**: User, Business, Membership, PasswordResetToken,
AuditEvent, Notification, Announcement, PlatformSetting (key/value JSON).

**Catalogue**: Category (self-referencing tree, department-tagged), Product,
Barcode (multi, unique per business), UnitConversion, Supplier,
SupplierProduct (supplier code + last cost).

**Purchasing**: PurchaseOrder (+ lines: qty, unitCost, receivedQty),
GoodsReceipt (+ lines: qty, unitCost, batchNumber, expiryDate for medicines),
supplier balance cached on Supplier (derived from receipts/returns/payments).

**Pharmacy**: PharmacyBatch (batchNumber, expiryDate, qtyReceived,
qtyRemaining, unitCost, supplier, status), movements reference batches.

**Sales**: Sale (header: numbers, totals, cashier, shift, channel, status),
SaleItem (product snapshot, department, qty in sold unit + base qty,
price, cost snapshot, discount, tax, lineTotal, batchAllocations JSON),
SalePayment (cash/transfer/card + reference), Refund (+ lines, approval,
restock flag), CashierShift (open/close, expected vs counted, discrepancy),
CashMovement (opening, sale cash, refunds, drops, payouts, closing).

**Finance**: Expense (+ category), tax config in BusinessSetting.

**SaaS commercial**: Plan (annualFee, deploymentFee, features JSON, terminal
limit, AI limit), Subscription (status machine, dates, grace), DeploymentOrder
(stage machine), Invoice (+ InvoiceLine kinds: deployment / subscription /
discount / other), PaymentTransaction (provider, reference, amount, status,
verifiedAt, meta), WebhookEvent (provider event id, payload, processing
status), PricingConfig (editable defaults for new businesses).

**AI**: AiSummary (period type/start/end, structured content JSON, model,
generatedAt), Forecast (product, horizon, method, demand estimate, low/high
band, available stock, incoming qty, suggested reorder, assumptions JSON,
actuals filled later), AiUsage (business, user, kind, tokens, createdAt).

**Import**: ImportJob (file, type, counts, row errors JSON).

## Indexing strategy

- Every tenant table: index on `(businessId, …)` hot filters — e.g.
  Sale `(businessId, createdAt)`, SaleItem `(saleId)`, StockMovement
  `(businessId, productId, createdAt)`, PharmacyBatch `(businessId,
  expiryDate)`, Product `(businessId, department, isActive)`.
- Unique: Product `(businessId, barcode)` + Barcode `(businessId, code)`,
  Product `(businessId, sku)`, Sale `(businessId, number)`,
  Sale `idempotencyKey`, PaymentTransaction `reference`,
  WebhookEvent `(provider, eventId)`, Membership `(userId, businessId)`,
  CashierShift one open per user `(businessId, userId, status=OPEN)` enforced
  in application logic.

## Integrity constraints worth naming

- `CHECK`-equivalent validation in server layer (SQLite lacks rich CHECKs
  via Prisma): totals = sum(lines) − discounts + tax; payment allocations ≤
  amount due; refund qty ≤ sold qty − already refunded.
- Expired batches: `status` + `expiryDate < today` both checked at sale time
  (defence in depth).
- Deletion policy: catalogue/products soft-delete (`isActive`) if ever sold;
  tenants' data never auto-deleted on non-renewal.

## Supabase migration path

1. Point `DATABASE_URL` at Supabase Postgres (direct connection for
   migrations; pooler for runtime), switch Prisma datasource provider to
   `postgresql`.
2. `prisma migrate dev` to generate SQL history; then add RLS policies +
   grants per docs/SECURITY.md §RLS.
3. `Decimal` columns map to `NUMERIC(14,2)` / `(14,4)`; JSON strings become
   `jsonb` (optional refinement).
