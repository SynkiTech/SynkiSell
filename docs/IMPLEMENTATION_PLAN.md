# SynkiSell — Implementation Plan & Checkpoint Checklist

Development proceeds checkpoint by checkpoint (per the Master Development
Prompt §16). Status marks are honest and updated as work completes: `[x]`
done, `[~]` partially done / integration boundary, `[ ]` not started.

## Checkpoint 0 — Repository audit & architecture
- [x] Workspace inspected (Next.js 16 + TS + Tailwind 4 + shadcn/ui + Prisma/SQLite)
- [x] Constraints identified: SQLite not Supabase (no credentials), no GitHub
      credentials (local commits only), single exposed route (SPA shell)
- [x] Architecture + docs: README, AGENTS, PRODUCT_REQUIREMENTS, ARCHITECTURE,
      DATABASE_DESIGN, SECURITY, IMPLEMENTATION_PLAN, TESTING
- [x] Branding asset placed (`public/branding/synkisell-logo.png`)
- [~] Local git initialised (push blocked — documented in AGENTS.md)

## Checkpoint 1 — Secure foundation
- [ ] Prisma schema: tenancy, memberships, settings, plans, subscriptions,
      invoices, payments, webhooks, catalogue, batches, movements, sales,
      shifts, expenses, audit, AI tables, imports, notifications
- [ ] NextAuth (credentials, JWT, scrypt), session carries active membership
- [ ] Permission matrix + guards (`lib/permissions.ts`, `lib/guards.ts`)
- [ ] Server-side tenant scoping helpers; audit writer
- [ ] Onboarding wizard (business + owner + initial staff)
- [ ] Seed: platform admin, demo business (pharmacy+supermarket), staff, plans
- [ ] Tenant isolation tests pass (see docs/TESTING.md)

## Checkpoint 2 — Inventory & purchasing
- [ ] Categories, products (multi-barcode, units, conversions, tax, images)
- [ ] Suppliers, supplier-product links, cost history
- [ ] Purchase orders (+ lines, partial receiving), goods receipts
- [ ] Pharmacy batches: expiry, per-batch cost, status; expired blocked
- [ ] Stock movement ledger + cached balances + adjustments with reasons
- [ ] CSV import with row-level validation errors
- [ ] Unit conversion accuracy tests, stock reconciliation tests

## Checkpoint 3 — POS & financial operations
- [ ] Unified POS (mixed basket, barcode/search, discounts by permission)
- [ ] Payments: cash, transfer (ref), card (recorded), split tender, change
- [ ] Transactional sales with idempotency; COGS snapshot; department mix
- [ ] Receipts (print view + reprint audit), sale history
- [ ] Returns/refunds with approval + restock; voids with manager approval
- [ ] Shifts: open/close, cash movements, reconciliation, discrepancy
- [ ] Expenses (categories, approval)
- [ ] Reports suite + CSV export; dashboard with real queries + freshness

## Checkpoint 4 — SaaS commercial operations
- [ ] Plans & pricing config editable in DB (defaults ₦60k/₦120k)
- [ ] Deployment orders (stage machine), invoices + lines (first invoice
      itemises deployment + subscription separately)
- [ ] Subscription lifecycle states + renewal dates + grace enforcement
- [ ] Paystack initialize/verify/webhook (HMAC-SHA512) + idempotent
      processing; mock/test mode until keys configured (labelled in UI)
- [ ] Renewal reminder generation (30/14/7/1 days)
- [ ] Platform admin console: businesses, deployments, invoices, payments,
      plans, announcements, metrics

## Checkpoint 5 — Offline operation & reliability
- [ ] IndexedDB catalogue cache + durable sale queue + client UUIDs
- [ ] Sync worker with retry + failure states + reconciliation UI
- [ ] Idempotent server replay (no duplicate stock deduction)
- [ ] Online/offline/pending/failed indicators; offline disclosure banners
- [ ] Real-network-interruption drill executed (documented in TESTING.md)

## Checkpoint 6 — AI business intelligence
- [ ] Aggregation layer (validated, tenant-scoped) feeding AI
- [ ] AI summaries (daily/weekly/monthly) with data-freshness labels
- [ ] Ask-your-business Q&A over authorised tools (no arbitrary SQL)
- [ ] Statistical forecasting + uncertainty + stockout adjustment + AI
      explanation; insufficient-history handling; forecast-vs-actual
- [ ] Usage metering + plan limits + graceful fallback

## Checkpoint 7 — Release readiness
- [ ] Lint/type-check pass; core business-rule tests pass
- [ ] Production build verification (build command restricted in sandbox;
      dev server + browser verification used instead — see TESTING.md)
- [ ] Supabase migration runbook ready (execution pending credentials)
- [ ] Paystack live verification pending keys
- [ ] Staging deployment + backup/restore drill (hosting env pending)

## Build sequence discipline

Modules are implemented in dependency order: tenancy → auth/guards →
catalogue → inventory/movements → purchasing → POS/financials → billing →
offline → AI. No module skips its guard or test requirements. Commits are
checkpoint-sized with descriptive messages. This file is updated at the end
of every checkpoint — never pre-marked.
