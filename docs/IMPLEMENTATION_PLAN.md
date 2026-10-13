# SynkiSell — Implementation Plan & Checkpoint Checklist

Development proceeded checkpoint by checkpoint (per the Master Development
Prompt §16). Status marks are honest: `[x]` done, `[~]` partially done /
integration boundary, `[ ]` not started.

## Checkpoint 0 — Repository audit & architecture
- [x] Workspace inspected (Next.js 16 + TS + Tailwind 4 + shadcn/ui + Prisma/SQLite)
- [x] Constraints identified: SQLite not Supabase (no credentials), no GitHub
      credentials (local commits only), single exposed route (SPA shell)
- [x] Architecture + docs: README, AGENTS, PRODUCT_REQUIREMENTS, ARCHITECTURE,
      DATABASE_DESIGN, SECURITY, IMPLEMENTATION_PLAN, TESTING
- [x] Branding asset placed (`public/branding/synkisell-logo.png`)
- [~] Local git initialised (push blocked — documented in AGENTS.md)

## Checkpoint 1 — Secure foundation
- [x] Prisma schema: tenancy, memberships, settings, plans, subscriptions,
      invoices, payments, webhooks, catalogue, batches, movements, sales,
      shifts, expenses, audit, AI tables, imports, notifications
- [x] NextAuth (credentials, JWT, scrypt), session carries active membership
- [x] Permission matrix + guards (`lib/permissions.ts`, `lib/guards.ts`)
- [x] Server-side tenant scoping helpers; audit writer
- [x] Registration creates business + owner + default expense categories +
      pending subscription + deployment order (onboarding wizard in UI)
- [x] Seed: platform admin, demo business (pharmacy+supermarket), staff, plans
- [x] Tenant isolation tests pass (44/44, see docs/TESTING.md)

## Checkpoint 2 — Inventory & purchasing
- [x] Categories, products (multi-barcode, units, conversions, tax)
- [x] Suppliers, supplier-product links, cost history via movements
- [x] Purchase orders (+ lines, partial receiving), goods receipts
- [x] Pharmacy batches: expiry, per-batch cost, status; expired blocked from
      allocation and from receiving
- [x] Stock movement ledger + cached balances + adjustments with reasons
- [x] CSV import with row-level validation errors (invalid rows reported)
- [x] Unit conversion accuracy tests, stock reconciliation tests (all pass)

## Checkpoint 3 — POS & financial operations
- [x] Unified POS (mixed basket, barcode/search, discounts gated by permission)
- [x] Payments: cash (change calc), transfer (ref), card (recorded only),
      split tender, balance-due sales
- [x] Transactional sales with idempotency; COGS snapshot; department mix
- [x] Receipts (print view + reprint audit)
- [x] Returns/refunds with approval + restock; voids (manager permission)
- [x] Shifts: open/close, cash movements, drops, reconciliation, discrepancy
- [x] Expenses (categories, approval flow)
- [x] Reports suite + CSV export; dashboard with real queries + freshness

## Checkpoint 4 — SaaS commercial operations
- [x] Plans & pricing config editable in DB (defaults ₦60k/₦120k)
- [x] Deployment orders (stage machine), invoices + lines (first invoice
      itemises deployment + subscription separately)
- [x] Subscription lifecycle states + renewal dates + grace enforcement
- [x] Paystack initialize/verify/webhook (HMAC-SHA512) + idempotent
      processing; mock/test mode until keys configured (labelled in UI)
- [x] Renewal reminder generation (30/14/7/1 days) + grace/expiry transitions
- [x] Platform admin console: businesses, deployments, invoices, manual
      payments, plans, pricing, announcements, metrics, reminder sweep
- [x] Verified lifecycle: renewal invoice (subscription only) → verified
      payment → subscription extended exactly 12 months; deployment fee not
      re-charged

## Checkpoint 5 — Offline operation & reliability
- [x] IndexedDB catalogue cache + durable sale queue + client UUIDs
- [x] Sync worker with retry + failure states + reconciliation affordance
- [x] Idempotent server replay (unique idempotency key; verified in tests)
- [x] Online/offline/pending/failed indicators; offline disclosure banners
- [x] Network-interruption drill executed via browser offline emulation:
      sale queued → reconnected → synced exactly once → stock reconciled

## Checkpoint 6 — AI business intelligence
- [x] Aggregation layer (validated, tenant-scoped) feeding AI
- [x] AI summaries (daily/weekly/monthly) with data-freshness labels
- [x] Ask-your-business Q&A over authorised tools (no arbitrary SQL);
      refuses/redirects when no tool fits
- [x] Statistical forecasting (exponential smoothing + trend + stockout
      adjustment) + uncertainty band + AI explanation; insufficient-history
      handling verified in browser
- [x] Usage metering + plan limits + graceful deterministic fallback

## Checkpoint 7 — Release readiness
- [x] Lint/type-check pass; 44/44 core business-rule tests pass
- [~] Production build verification (build command restricted in sandbox;
      dev server + browser verification used — see TESTING.md)
- [~] Supabase migration runbook ready (execution pending credentials)
- [~] Paystack live verification pending keys
- [~] GitHub push pending credentials (local commits made per checkpoint)
- [ ] Staging deployment + backup/restore drill (hosting env pending)

## Bugs found & fixed during verification (evidence of testing)

1. **Batch double-count**: goods receiving set batch quantity AND the
   movement ledger incremented it again → batch quantities inflated.
   Fixed: movement ledger is the single writer of batch remaining.
2. **Void cash-drawer bug**: voiding a sale reversed the full cash TENDERED
   instead of net cash (tender − change) → negative drawer. Found by
   automated tests; fixed.
3. **Future-dated seeded sales** made dashboard inconsistent (₦0 sales but
   ₦13k profit). Fixed seed + aligned all dashboard windows.
4. **SQLite date() grouping**: Prisma stores DateTime as ms epoch;
   `date(createdAt)` returned NULL. Fixed with `date(ts/1000,'unixepoch')`
   and grouping by the authoritative Sale date.
5. **Decimal serialization**: Prisma Decimal objects cannot cross the
   server→client boundary in Next.js. Fixed with a deep plain-object
   serializer at the guarded() boundary and in queries.
6. **Manual payment state machine**: pre-marking payment SUCCESS before
   applyVerifiedPayment caused the idempotency guard to skip application.
   Fixed: apply owns the state transition.

## Build sequence discipline

Modules were implemented in dependency order: tenancy → auth/guards →
catalogue → inventory/movements → purchasing → POS/financials → billing →
offline → AI. No module skipped its guard or test requirements. Commits are
checkpoint-sized with descriptive messages.
