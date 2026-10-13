# SynkiSell — Security

## Threat model in one line

Multiple independent businesses share one application; the primary risk is
**cross-tenant data exposure** and **unauthorised financial mutations**, plus
standard web application risks.

## Authentication

- NextAuth.js v4, credentials provider, **JWT session** in an httpOnly,
  SameSite=Lax cookie; JWT includes userId, active businessId + membership
  role, platformAdmin flag.
- Passwords: scrypt (node:crypto) with per-user random salt, constant-time
  comparison. No plaintext, no reversible storage.
- Login rate-limited (per email + per IP) with lockout backoff.
- Password reset: single-use, expiring tokens; hashes stored, never the
  token itself.
- Session invalidation on membership deactivation: every guarded action
  re-reads the membership from the DB (not just the JWT claims) — deactivating
  a staff member is effective immediately.

## Authorisation (server-enforced RBAC)

- `src/lib/permissions.ts` defines the role → permission matrix. Permissions
  are string capabilities (`product.create`, `sale.refund`, `staff.manage`,
  `reports.financial`, …) with per-membership overrides (`extraPermissions`).
- Every server action / route handler resolves context via `guards.ts`:
  1. `requireAuth()` — valid session
  2. `requireBusiness(businessId)` — session's active business must match and
     membership must be active (guards re-verify from DB)
  3. `requirePermission(perm)` — explicit capability check
- Platform admin routes additionally require `platformAdmin` flag and are
  audited. Platform admin access is separate from any business membership.
- **The client is never trusted** for: tenant id, role, prices, discounts,
  quantities, totals, subscription status, idempotency "already processed"
  claims. Totals are recomputed server-side from DB prices; client values are
  treated as UI hints only.

## Tenant isolation

- Every read/write helper takes the resolved `businessId` from the session
  context — never from request body/query.
- Cross-tenant guard tests (see docs/TESTING.md) assert Business A cannot
  read/update/insert/delete/export Business B records through any action, and
  AI tools cannot leak B's data into A's answers.
- Dashboard/reports/AI aggregations filter by `businessId` at the query root.

## Data protection

- No card numbers/PINs stored, ever; card payments stored as method +
  provider reference only.
- Paystack secret keys server-only (`process.env`, never NEXT_PUBLIC).
- AI: minimum-necessary aggregates only; no patient/prescription/PII payloads;
  prompts and logs scrub business names when not required.
- Audit log (`AuditEvent`) is append-only through the application (no update/
  delete actions exist); records actor, action, entity, metadata, reason.
- Sensitive events audited: login, price changes, stock adjustments, goods
  receiving, discounts, refunds, voids, payment corrections, permission
  changes, plan/subscription changes, exports, reprint receipts, AI admin
  changes.

## Application hardening

- Zod validation on every server action input (types, lengths, ranges,
  enums); Prisma parameterised queries (no string-built SQL).
- Rate limiting on auth, POS complete-sale, AI endpoints.
- Security headers via Next config: X-Frame-Options DENY, X-Content-Type-
  Options nosniff, Referrer-Policy strict-origin-when-cross-origin,
  Permissions-Policy minimal.
- Errors: server errors logged with context but returned to clients as
  safe messages (no stack traces / SQL to the browser).

## Database-level controls (current vs target)

- **Now (SQLite sandbox)**: isolation enforced in the guarded server layer;
  unique constraints as specified in DATABASE_DESIGN.md; transactions for
  multi-record writes.
- **On Supabase migration (required before production)**:
  - Enable RLS on every tenant table; policies `USING (businessId IN (SELECT
    business_id FROM memberships WHERE user_id = auth.uid() AND active))`.
  - App connects with a non-superuser role; service-role key only in server
    env for admin jobs, never to the browser.
  - Explicit grants: `REVOKE ALL … ; GRANT SELECT/INSERT/UPDATE … TO app_role`.
  - Automated backups + a tested restore runbook; incident-response doc.

## Known gaps in this workspace (honest list)

- Supabase/PostgreSQL not connected → RLS cannot be exercised here; the
  server-layer guards + tests are the current control. Migration checklist
  above is mandatory before production.
- Email verification / SMTP not configured (no provider credentials).
- Backups: SQLite file in sandbox; Supabase backups apply post-migration.
