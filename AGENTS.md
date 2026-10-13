# AGENTS.md — SynkiSell Engineering Guide

## Project

SynkiSell — a multi-tenant SaaS platform for Nigerian businesses that operate a
pharmacy and a supermarket together. One business account, one shared POS, one
consolidated dashboard; specialised workflows per department where they differ.

Canonical repository (see "Git remote status" below):
`https://github.com/SynkiTech/SynkiSell.git`

## Environment constraints (read before coding)

This workspace is a managed sandbox. The following constraints are **real** and
were verified during Checkpoint 0; every module must respect them:

1. **Framework**: Next.js 16 App Router + TypeScript strict. Non-negotiable.
2. **Database**: Prisma ORM with a SQLite file database
   (`DATABASE_URL=file:/home/z/my-project/db/custom.db`). Supabase PostgreSQL
   credentials were NOT provided (connection template uses a placeholder
   password). Therefore:
   - The Prisma schema is written PostgreSQL-compatible (String enums,
     Decimal money, no SQLite-only column types, no DB-level arrays — JSON
     strings instead).
   - Tenant isolation is enforced **in the server layer** (all queries go
     through guarded helpers that derive tenant scope from the session), not
     via PostgreSQL RLS. When migrating to Supabase, RLS policies must be
     added (see docs/SECURITY.md §RLS migration).
3. **Single exposed route**: the preview gateway serves `/`. The application is
   therefore built as a fast SPA-style interface: one page shell, view-state
   navigation, API routes under `/api/*`. This also suits POS latency goals.
4. **Auth**: NextAuth.js v4 (credentials provider, JWT session,
   scrypt password hashing via `node:crypto`). Supabase Auth unavailable.
5. **AI**: server-side only via `z-ai-web-dev-sdk`. Never import it in client
   code. Financial aggregates are computed by validated server logic first;
   the LLM only explains/summarises those numbers.
6. **Payments**: Paystack integration is implemented as a real integration
   boundary (initialize / verify / webhook with HMAC-SHA512 signature check)
   but runs in **mock/test mode** until `PAYSTACK_SECRET_KEY` is configured.
   Mock operations are always labelled as such in the UI.
7. **Dev server**: started automatically on port 3000. Never run `bun run
   build` in this sandbox. Use `bun run lint` and targeted tests.

## Architecture map

```
prisma/schema.prisma          # Full multi-tenant schema (see docs/DATABASE_DESIGN.md)
src/lib/
  auth.ts                     # NextAuth config (JWT, scrypt, session shape)
  permissions.ts              # Role → permission matrix (server source of truth)
  guards.ts                   # requireAuth / requireBusiness / requirePermission
  audit.ts                    # Audit event writer (actor, action, entity, reason)
  money.ts                    # Decimal money helpers (NGN), tax math
  fefo.ts                     # FEFO batch allocation logic
  offline/db.ts               # IndexedDB store for offline POS
  offline/sync.ts             # Idempotent sync queue
src/server/actions/*.ts       # Server actions per module (all tenant-guarded)
src/server/queries/*.ts       # Read/query helpers (aggregations, reports)
src/components/app/*          # App shell, navigation, view components
src/components/pos/*          # POS checkout components
src/store/app-store.ts        # Zustand UI state (active view, cart, session ctx)
```

## Rules for any agent working here

1. Read `docs/IMPLEMENTATION_PLAN.md` and the checkpoint checklist before
   starting; do not skip ahead of unimplemented dependencies.
2. Every server action MUST: authenticate → resolve membership → check
   permission → scope every query by `businessId` from the **server session**,
   never from client input.
3. Money arithmetic only with `Prisma.Decimal` / helpers in `lib/money.ts`.
   No floats. No `toFixed` rounding before persistence.
4. Every stock change MUST go through the stock movement ledger
   (`recordStockMovement`); cached `StockBalance` is derived and reconcilable.
5. Sales, refunds, goods receipts are transactional (`prisma.$transaction`).
   Retried operations require a client-generated idempotency key.
6. Audit sensitive actions (price changes, discounts, refunds, voids,
   permission changes, subscription changes) via `lib/audit.ts`.
7. Do not fake success states. Unavailable integrations surface explicit,
   honest status in the UI and docs.
8. Never commit secrets. `.env*` files are git-ignored; `.env.example` holds
   placeholders only.
9. Run `bun run lint` after meaningful changes; keep TypeScript strict-clean.
10. Update the checkpoint checklist in `docs/IMPLEMENTATION_PLAN.md` when a
    checkpoint's items are genuinely done.

## Git remote status

The sandbox has local git (branch `main`) but no GitHub credentials, so pushes
to `https://github.com/SynkiTech/SynkiSell.git` are **blocked**. Milestones are
committed locally with clear messages. To enable push:

```bash
git remote add origin https://github.com/SynkiTech/SynkiSell.git
# authenticate (gh auth login / PAT), then:
git push -u origin main
```

Never force-push. Never claim a push succeeded without confirmation.
