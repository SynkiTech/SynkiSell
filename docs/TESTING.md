# SynkiSell — Testing

## Strategy

Two tiers, given the sandbox:

1. **Automated test script** (`scripts/test-business-rules.ts`) — runs against
   a scratch database and exercises the real server logic (the same functions
   the UI calls): tenancy guards, permission checks, FEFO allocation, unit
   conversion, sale transaction integrity, idempotent retries, refunds,
   shifts, billing rules, AI tool scoping. Reports pass/fail per case.
2. **Browser verification** — the dev server is exercised end-to-end with an
   automated browser: login per role, POS sale flow, inventory updates,
   dashboard figures, admin console. Console/runtime errors are checked.

## Test cases (master prompt §14 mapping)

### Tenant security
- Business A user cannot fetch/update/delete Business B products, sales,
  suppliers, reports; cross-tenant id passed explicitly → denied.
- Cashier denied owner-only operations (price change, staff, expenses approve).
- Deactivated membership → next guarded call rejected.
- AI Q&A with "show Business B sales" → refuses/discloses no access.

### POS & inventory
- Combined pharmacy+supermarket basket → one sale, correct totals, both
  departments attributed, one receipt number.
- Stock movements created exactly once per line; balances reconcile.
- Retry of the same sale (same idempotency key) → returns original, no
  duplicate stock deduction, no duplicate payment.
- FEFO: earliest-expiry active batch consumed first; allocation persisted on
  the sale line; expired batch never allocated.
- Carton→piece conversion: selling 1 carton decrements 12 base units.
- Refund: qty capped at sold-minus-refunded; restock movement to same batch;
  totals correct; audit written.
- Shift: expected cash = opening + cash sales − cash refunds; counted vs
  expected discrepancy recorded.

### Billing
- Deployment fee charged once; renewal invoice contains subscription only.
- Unverified/mock-unconfirmed payment cannot activate a subscription.
- Repeated webhook event (same provider event id) processed once.
- Reminder records generated at 30/14/7/1 days; grace transitions correct.

### AI & forecasts
- Summaries built from aggregates matching direct SQL-equivalent computation.
- Missing cost data → disclosed in output, not invented.
- Forecast with < 7 days history → labelled preliminary / insufficient.
- AI failure (simulated) → fallback summary shown; no transaction corruption.

### Offline
- Sale persisted locally while offline; syncs exactly once on reconnect
  (duplicate replay ignored by server).
- Failed sync visible with retry; local sales survive reload.

## Running

```bash
bun run test:rules    # scripts/test-business-rules.ts
bun run lint          # static checks
```

## Results log (updated per checkpoint)

| Date | Suite | Result | Notes |
|---|---|---|---|
| — | — | — | populate as checkpoints complete |

## Sandbox limitations (honest)

- `bun run build` is restricted in this sandbox; production-build evidence is
  replaced by dev-server runtime + lint + type-clean checks. A full
  `next build` must be run in CI/hosting before release.
- No test runner (vitest/jest) is preinstalled; the rules suite is a
  self-contained bun/tsx script to avoid heavy dev deps in the sandbox.
