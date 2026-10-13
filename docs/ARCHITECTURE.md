# SynkiSell — Architecture

## System shape

```
┌────────────────────────────── Browser ──────────────────────────────┐
│  Next.js App shell (single route, view-state navigation — SPA style)│
│  • Unauthenticated: login / register / onboarding views             │
│  • Platform admin console (Layer A)                                 │
│  • Business workspace (Layer B): dashboard, catalogue, inventory,   │
│    purchasing, suppliers, staff, expenses, reports, AI, billing     │
│  • POS terminal (Layer C): fast checkout + offline queue (IndexedDB)│
└──────────────┬──────────────────────────────────┬───────────────────┘
               │ fetch / server actions           │ IndexedDB (offline)
┌──────────────▼──────────────────────────────────▼───────────────────┐
│                        Next.js server (Node)                        │
│  NextAuth session (JWT, httpOnly cookie)                            │
│  guards.ts: requireAuth → requireBusiness → requirePermission       │
│  server/actions/*  (writes — transactional, audited, tenant-scoped) │
│  server/queries/*  (reads — aggregations, reports, AI inputs)       │
│  lib/fefo.ts (batch allocation)  lib/money.ts (Decimal math)        │
│  paystack.ts (initialize/verify/webhook HMAC-SHA512, mock fallback) │
│  ai/*.ts (z-ai-web-dev-sdk, server-only; tool-calling over          │
│            authorised aggregate functions; usage metering)          │
└──────────────┬──────────────────────────────────────────────────────┘
               │ Prisma (PostgreSQL-compatible schema; SQLite now)
        ┌──────▼───────┐
        │   Database   │  tenants + users + memberships + settings
        │              │  catalogue + batches + movements + balances
        │              │  sales/items/payments/refunds/shifts/expenses
        │              │  plans/subscriptions/invoices/payments/webhooks
        │              │  audit events, AI summaries/forecasts/usage
        └──────────────┘
```

## Why a single-route SPA shell

The preview gateway exposes `/` only. Rather than a static prototype, the app
is a genuine client-side application shell: Zustand holds the active view +
session context; all data flows through server actions/route handlers. This
matches POS latency goals (no page loads mid-sale) and keeps one hardened
server boundary.

## Transaction integrity rules

1. **Sale completion** runs in one `prisma.$transaction`: insert sale header →
   items (with FEFO batch allocations recorded per line) → payments →
   stock movements → decrement cached balances → decrement batch quantities →
   cash movement (if cash) → audit event. Any failure rolls back everything.
2. **Idempotency**: the POS client generates a UUID per sale attempt. The
   server enforces a unique constraint on `Sale.idempotencyKey`; retries
   return the existing sale instead of creating duplicates (no double stock
   decrement on reconnect/retry).
3. **Refunds** never rewrite the original sale: linked `Refund`/`RefundLine`
   records + reversal stock movements (restock to same batch where possible).
4. **Goods receipt** updates PO lines (received quantities, partial status)
   and creates batches (medicines) / movements (all goods) atomically.
5. **Stock** is an auditable movement ledger; `StockBalance` is a cached
   projection, reconcilable via `SUM(movements)` per product. A repair
   routine recomputes balances from the ledger.
6. **Money** uses `Prisma.Decimal` (decimal.js) end-to-end: entry → storage →
   aggregation → display. No binary floats.

## Offline POS design (release 1)

- On POS load: catalogue snapshot (id, name, barcodes, prices, tax, unit,
  department, batch info summary) cached to IndexedDB with a version stamp.
- Sale flow offline: cart completes → stored in IndexedDB `sales` with
  client UUID + `pending` state; stock checks against cached balance with
  explicit "may be out of date" disclosure; offline selling rules per
  settings (allow with warning / block when unknown).
- Connectivity restored: sync worker replays queue (oldest first) with the
  same idempotency key; server result flips state to `synced` (receipt
  numbered) or `failed` (recoverable via explicit reconciliation UI).
- Indicators: online/offline chip, pending count, last sync time. Nothing is
  represented as cloud-synced until the server confirms.
- Scope guard: single terminal per business offline mode; multi-terminal
  conflict resolution is explicitly out of scope for release 1.

## AI integration design

- All financial/stock aggregates computed by `server/queries` with tenant
  scoping; AI receives compact JSON summaries (numbers, periods, labels) —
  never raw SQL, never other tenants' data, never prescription/PII content.
- Q&A: a fixed registry of authorised tools (`salesSummary`, `topProducts`,
  `lowStock`, `expiringStock`, `departmentComparison`, `supplierPriceChanges`,
  `stockAdjustments`, `comparePeriods`, `stockValuation`, `cashierPerformance`).
  The model selects tools + arguments (validated by zod); answers render the
  computed result with period labels; when no tool fits, it says what's
  missing instead of guessing.
- Forecasting: pure TS statistical service (moving average + exponential
  smoothing variants, day-of-week weighting, stockout adjustment) → numeric
  outputs stored in `Forecast`; AI writes the explanation text only.
- Usage metering per business per plan limit; failures fall back to a static
  rendered summary of the computed aggregates (labelled as non-AI).

## Module → file map

| Module | Server | UI |
|---|---|---|
| Auth/onboarding | `actions/auth.ts`, `actions/onboarding.ts` | views `Login`, `Register`, `Onboarding` |
| Dashboard | `queries/dashboard.ts` | `DashboardView` |
| Catalogue | `actions/products.ts`, `queries/products.ts` | `ProductsView` |
| Pharmacy batches | `actions/inventory.ts` | `InventoryView` (batches tab) |
| Stock ops | `actions/inventory.ts`, `lib/fefo.ts` | `InventoryView` |
| Suppliers/POs | `actions/purchasing.ts` | `PurchasingView`, `SuppliersView` |
| POS | `actions/pos.ts` (completeSale, refund, shift) | `PosView`, `ShiftsView` |
| Expenses | `actions/expenses.ts` | `ExpensesView` |
| Reports | `queries/reports.ts` | `ReportsView` |
| Staff | `actions/staff.ts` | `StaffView` |
| Billing | `actions/billing.ts`, `paystack.ts` | `BillingView`, `AdminConsole` |
| AI | `ai/*`, `actions/ai.ts` | `InsightsView` |
| Audit | `lib/audit.ts`, `queries/audit.ts` | `SettingsView` (audit tab) |
