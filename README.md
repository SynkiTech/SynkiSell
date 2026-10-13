# SynkiSell

**Multi-tenant business management SaaS for combined pharmacy + supermarket
operations — built for Nigerian businesses, starting in Osun State.**

One business account. One shared point of sale. One consolidated dashboard.
Pharmacy and supermarket get specialised workflows (batch/FEFO/expiry control
for medicines; barcode/unit/promotions for retail) while sharing sales,
purchasing, suppliers, staff, expenses, payments, and reporting.

![SynkiSell](public/branding/synkisell-logo.png)

## What is included

| Layer | Description |
|---|---|
| **A — SaaS platform admin** | Register/review businesses, manage plans & pricing, deployment orders, subscriptions & renewals, invoices, payments, announcements, platform metrics. |
| **B — Business workspace** | Dashboard, product catalogue, pharmacy batch inventory (FEFO), supermarket inventory, suppliers & purchasing, staff & roles, expenses, reports, AI insights, subscription & settings. |
| **C — Local POS operation** | Fast unified checkout (pharmacy + supermarket in one basket), barcode scanning, keyboard-first, cash/transfer/card & split payments, receipts, shifts & reconciliation, offline queue (IndexedDB) with idempotent sync. |

## Tech stack

- **Next.js 16 (App Router) + TypeScript (strict)** — SPA-style shell with
  server actions & route handlers; all business logic server-side.
- **Tailwind CSS 4 + shadcn/ui (New York)** — accessible components, Lucide icons.
- **Prisma ORM** — PostgreSQL-compatible schema; local SQLite in this sandbox,
  designed for a direct move to Supabase PostgreSQL (see `docs/SECURITY.md`).
- **NextAuth.js v4** — credentials auth, JWT sessions, scrypt password hashing.
- **Paystack** — deployment fee + annual subscription payments (initialize /
  verify / signed webhook). Test mode until keys are configured.
- **AI (server-side)** — business summaries, "ask your business" Q&A over an
  authorised tool set (never raw SQL), statistical demand forecasting with
  AI-written explanations.
- **Offline POS** — IndexedDB catalogue cache + durable transaction queue +
  idempotent replay; single-terminal offline mode for release 1.

## Quick start (sandbox)

```bash
bun run db:push       # apply Prisma schema
bun run seed          # seed platform admin + demo business (scripts/seed.ts)
bun run lint          # ESLint
bun run dev           # dev server on :3000 (managed automatically in sandbox)
```

## Demo accounts (seeded)

| Role | Email | Password | Sees |
|---|---|---|---|
| Platform admin | `admin@synkisell.com` | `SynkiAdmin#2026` | SaaS administration |
| Business owner | `owner@firstpharmplus.ng` | `Owner#2026` | Full business workspace |
| Manager | `manager@firstpharmplus.ng` | `Manager#2026` | Operations, purchasing, reports |
| Cashier | `cashier@firstpharmplus.ng` | `Cashier#2026` | POS, own shifts |

> These are development seeds only. Rotate or remove before production.

## Documentation

- `docs/PRODUCT_REQUIREMENTS.md` — scope & module requirements
- `docs/ARCHITECTURE.md` — layers, module map, transaction integrity
- `docs/DATABASE_DESIGN.md` — schema, tenancy, money, stock ledger
- `docs/SECURITY.md` — authN/authZ, tenant isolation, RLS migration path
- `docs/IMPLEMENTATION_PLAN.md` — checkpoints & live checklist
- `docs/TESTING.md` — test strategy & results
- `AGENTS.md` — engineering rules for anyone (or any agent) touching the code

## Honest status of external integrations

| Integration | State in this workspace |
|---|---|
| Supabase PostgreSQL | **Not connected** — credentials not provided; SQLite used; schema kept migration-ready |
| Paystack | **Test/mock mode** — full flow implemented; activates when `PAYSTACK_SECRET_KEY` is set |
| GitHub push | **Blocked** — no credentials in sandbox; commits are local (see AGENTS.md) |
| AI provider | **Active** — server-side SDK configured in sandbox |
| Email delivery | **Not configured** — reminders/notifications stored in-app; SMTP/mail provider pending |
