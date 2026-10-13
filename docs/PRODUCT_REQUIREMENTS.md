# SynkiSell — Product Requirements (implementation-scoped)

Source: SynkiSell Master Development Prompt. This document restates the
requirements as buildable scope for this codebase, and records scoping
decisions for release 1.

## Product identity

- Name: **SynkiSell** (never renamed/substituted).
- Branding (logo, colours, contact details, receipt header/footer) is stored as
  configurable business settings with SynkiSell defaults.
- Market: Nigerian businesses (pilot: Osun State). Default currency **NGN (₦)**.

## Commercial model

- Subscription SaaS + one-time deployment fee, charged **separately**:
  - Proposed defaults (editable in platform admin, stored in DB, not code):
    deployment ₦60,000; annual subscription ₦120,000; first year ₦180,000;
    renewal ₦120,000. Deployment fee never re-charged at renewal.
- Platform admin can create plans, custom quotes, offers, discounts.
- Subscription states: `PENDING_PAYMENT, ACTIVE, PAST_DUE, GRACE, SUSPENDED,
  EXPIRED, CANCELLED`.
- Deployment stages: `AWAITING_PAYMENT, PAYMENT_CONFIRMED, AWAITING_SETUP,
  SETUP_IN_PROGRESS, AWAITING_CUSTOMER_DATA, READY_FOR_VERIFICATION, LIVE`.
- Renewal reminders at 30/14/7/1 days before expiry; grace period default
  7 days (configurable). Enforcement: at grace end, operational modules lock
  while billing/data-export remains available; data is never auto-deleted.
- Payments: Paystack (test mode). Server-side verification is the only path to
  activate invoices/subscriptions; webhook signature verified (HMAC-SHA512);
  idempotent processing keyed by provider reference/event id. Browser redirects
  never activate anything.

## Layers

- **A. Platform administration** — businesses, plans/pricing, deployment
  orders, subscriptions, invoices/payments, support notes, announcements,
  platform metrics, AI usage oversight.
- **B. Business workspace** — per-tenant isolated workspace (see modules).
- **C. POS operation** — speed-first checkout; offline single-terminal mode.

## Roles (RBAC, enforced server-side)

`PLATFORM_ADMIN`, `OWNER`, `MANAGER`, `CASHIER`, `INVENTORY_MANAGER`,
`PHARMACIST`, `ACCOUNTANT`. Users may hold multiple memberships; permissions
are explicit per membership (see `src/lib/permissions.ts`). Menu hiding is not
security; every server action re-checks permissions and tenant scope.

## Modules

1. **Registration & onboarding** — guided wizard: business identity,
   type (pharmacy / supermarket / combined), state, currency (NGN default),
   receipt settings, initial staff invites; progress tracking; CSV product
   import with row-level validation errors (invalid rows surfaced, never
   silently dropped).
2. **Business dashboard** — today's sales vs previous comparable period,
   estimated **gross** profit (clearly distinct from net), per-department
   performance, low stock, expiry review, recent purchases/expenses, supplier
   balances, refunds/voids, current shift status, subscription status. All
   figures from real queries with period + freshness labels.
3. **Product catalogue** — shared catalogue, department assignment
   (PHARMACY/SUPERMARKET/BOTH), SKU + multi-barcode (unique per business),
   category tree, cost/price/wholesale, tax rate, UoM + validated conversions
   (carton→pack→unit), reorder level, image, active flag. Medicines flagged
   `MEDICINE` and batch-tracked.
4. **Pharmacy inventory** — batch/lot tracking with expiry, per-batch cost,
   goods-received linkage, adjustments with reasons, expiry warnings
   (configurable window), expired batches blocked from normal sale, near-expiry
   valuation, FEFO allocation preserved on the sale line, stock movement
   history, supplier returns. No clinical diagnosis/treatment features;
   dispensing respects pharmacist permissions.
5. **Supermarket inventory** — receiving, barcode identification, unit
   conversions (buy carton, sell piece), adjustments, reorder alerts, damaged
   stock, supplier returns, valuation, fast/slow movers, price changes with
   history, promotion/discount config.
6. **Unified POS** — mixed basket, one sale, one receipt; barcode + search +
   keyboard flow; line/transaction discounts gated by permission; payments:
   cash, bank transfer (reference), card recorded (no PAN storage), split
   tender; change calculation; receipt reprint (audited); sale history;
   returns/refunds with approval; voids with manager approval + reason;
   shifts with opening float, cash movements, close & reconciliation,
   discrepancy report. Every sale: header + items + department attribution +
   payments + stock movements + COGS + receipt + audit, in **one DB
   transaction**, keyed by client idempotency id (retry-safe).
7. **Purchases & suppliers** — supplier records (terms, category, status),
   POs → goods receipts (partial deliveries, rejections), batch/expiry capture
   for medicines on receipt, supplier balances & transaction history, purchase
   returns, cost history. PO creation never implies stock received.
8. **Expenses** — categorised operating expenses with payment method, payee,
   receipt attachment reference, entered-by, approval where required. Reports
   disclose what is included/excluded; not a statutory accounting system.
9. **Reports & exports** — sales (period/department/product/cashier), gross
   profit by product & department, purchases, supplier balances, stock
   valuation, low stock, expiring/expired batches, adjustments, refunds/voids,
   discounts, expense summaries, payment methods, shift reconciliation, audit
   history. CSV export + print-friendly layout; tenant-scoped and
   permission-protected.
10. **Staff & audit** — staff accounts, role assignment, activation, secure
    reset; audit log for logins, price changes, stock adjustments, purchases,
    discounts, refunds, voids, payment corrections, permission changes,
    subscription changes. Audit records are append-only through the app.
11. **AI summaries** — daily/weekly/monthly generated from server-computed
    aggregates only; disclose missing data; show period + data timestamp; no
    invented figures; dashboard delivery first (email/WhatsApp later, with
    consent).
12. **Ask your business** — NL Q&A routed to an explicit set of authorised
    query tools (no arbitrary SQL, no cross-tenant access); answers cite the
    period and basis; unreadable questions answered with what's missing; AI
    never performs write actions.
13. **Forecasting** — statistical engine (moving average / exponential
    smoothing with trend & seasonality-light heuristics) over real sales;
    stockout-aware (distinguishes recorded sales from demand); outputs
    demand estimate, uncertainty band, available stock, incoming POs, lead
    time, suggested replenishment, assumptions; preliminary-estimate label
    when history is short; forecast-vs-actual comparison; AI writes the human
    explanation of the computed numbers only.
14. **AI cost & access controls** — per-business usage tracking, plan limits,
    rate limiting, response caps, safe fallback when provider unavailable,
    minimal data sent, no PII/prescription data to provider.

## Release-1 scoping decisions (documented honestly)

- Single store location per business; schema keeps `locationId`-ready design.
- Offline = single-terminal sales mode with durable local queue; no
  multi-terminal shared-stock claims.
- Email/WhatsApp delivery of summaries: deferred (in-app + stored).
- Card-present till payments are recorded (reference-based), not processed in
  software; no PAN/PIN storage.
- Pharmacy dispensing prescriptions workflow: role-gated logging only; no
  clinical decision features; legal requirements flagged for review.
