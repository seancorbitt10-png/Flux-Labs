# Environment

## Local

1. PostgreSQL 14+ running
2. Copy `.env.example` → `.env.local`
3. `npm install`
4. `npx prisma migrate dev`
5. `npm run dev`

## Variables

| Name | Required | Purpose |
|------|----------|---------|
| `DATABASE_URL` | yes | PostgreSQL connection |
| `AUTH_SECRET` | yes | Auth.js secret |
| `AUTH_URL` | yes | Canonical app URL |
| `AI_PRODUCTION_ENABLED` | no | Explicit production AI gate (`true` to allow non-stub). Default: off |
| `AI_PROVIDER` | no | Server provider kind: `stub` (default) or `openai` (requires production gate) |
| `OPENAI_API_KEY` | no | OpenAI API key — server-only; ignored unless production gate + `AI_PROVIDER=openai` |
| `OPENAI_BASE_URL` | no | OpenAI API base URL (default `https://api.openai.com/v1`) |
| `AI_TIMEOUT_MS` | no | Upstream request timeout (default 25000; clamped 1000–120000) |
| `AI_MAX_OUTPUT_TOKENS` | no | Server max completion tokens (default **800**; hard-capped by `AI_REQUEST_ENVELOPE`, cannot exceed 800) |
| `AI_MAX_INPUT_CHARS` | no | Server max total input characters (default **12000**; hard-capped by `AI_REQUEST_ENVELOPE`, cannot exceed 12000) |
| `AI_MODEL_FLUX_FAST` | no | Vendor model id for internal `flux-fast` |
| `AI_MODEL_FLUX_STANDARD` | no | Vendor model id for internal `flux-standard` |
| `AI_MODEL_FLUX_ADVANCED` | no | Vendor model id for internal `flux-advanced` |

## AI production gate

Production AI stays **disabled** unless **all** of the following are true:

1. `AI_PRODUCTION_ENABLED=true`
2. `AI_PROVIDER=openai`
3. `OPENAI_API_KEY` is set

Otherwise the runtime uses the **stub** provider (safe default for CI and local).

Presence of an API key alone does **not** enable production AI.

## Secrets

Never commit `.env` / `.env.local`. Never ship provider API keys to the browser.
Provider configuration and credentials are server-side only. Clients cannot select
provider, model, API key, endpoint, temperature, or token limits.

## Authoritative AI request envelope

Provider acceptance limits and reservation-cost ceilings share one server-side
source of truth (`AI_REQUEST_ENVELOPE` in `src/lib/ai/request-envelope.ts`):

- max input characters: **12000**
- max output tokens: **800**
- reservation cost assumes a conservative char→token overestimate (≤1 token per input char) plus max output tokens
- `reservedCostMicros` is internal accounting, **not** a vendor invoice
- environment variables may **lower** these limits; they cannot raise them above the envelope
- clients cannot raise the envelope
- requests over the envelope are rejected before provider dispatch (`not_dispatched` → RELEASE)

## AI usage accounting (Phase 4 Implementation #2)

Server-side only:

- `AiUsageOperation` tracks RESERVED → SETTLED | RELEASED
- Reservation holds capability **and** a conservative server-side `reservedCostMicros` ceiling derived from the same authoritative request envelope the provider enforces
- `reservedCostMicros` ≠ actual provider cost / vendor invoice; settlement records the best server-side estimate available
- Outstanding RESERVED cost is included in budget availability; RELEASED is excluded; SETTLED remains included
- Failure classification by execution certainty:
  - safe non-execution (`not_dispatched`) → RELEASE
  - ambiguous / dispatched provider failure → SETTLE (consume)
- Clients cannot supply plan, remaining usage, reservation amount, cost, settlement outcome, or operation id
- Settlement/release is idempotent by server-generated operation id
- Production AI remains gated by `AI_PRODUCTION_ENABLED` (default off)
- Exact vendor billing reconciliation remains future work

