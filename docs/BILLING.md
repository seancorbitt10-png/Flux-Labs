# Billing & entitlements

## Principle

Plans differentiate by **user-facing capabilities and allowances**, not model names.

All meaningful checks are **server-side**.

## Plans (configurable)

Defined in `src/lib/entitlements/plans.ts`:

- `FREE_TRIAL` — 7-day controlled trial
- `PLUS`
- `PRO`

Exact pricing is **not** locked.

## Trial (experimental defaults)

- Duration: 7 days
- ~10 AI sessions
- ~3 document analyses
- ~1 advanced tutoring session
- Soft AI budget ceiling ~$2.00 (micros)

Numbers are experimental and must remain configurable.

## Phase 1 vs Phase 9

Phase 1: provision trial on signup, enforce counters/budget, store entitlement state.

Phase 9: payment provider, conversion flow, invoice webhooks, dunning — only when product experience is ready.
