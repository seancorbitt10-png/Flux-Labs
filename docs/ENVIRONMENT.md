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
| `AI_MAX_INPUT_TOKENS` | no | Server max billable input tokens via o200k_base (default **8000**; hard-capped by `AI_REQUEST_ENVELOPE`, cannot exceed 8000) |
| `AI_MAX_INPUT_UTF16_UNITS` | no | Optional DoS prefilter on JS UTF-16 code units (default **64000**; not a token-cost bound) |
| `AI_MODEL_FLUX_FAST` | no | Allowlisted vendor model id for internal `flux-fast` (default `gpt-4o-mini`; must be verified o200k_base) |
| `AI_MODEL_FLUX_STANDARD` | no | Allowlisted vendor model id for internal `flux-standard` (default `gpt-4o-mini`; must be verified o200k_base) |
| `AI_MODEL_FLUX_ADVANCED` | no | Allowlisted vendor model id for internal `flux-advanced` (default `gpt-4o`; must be verified o200k_base) |

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

- max billable input tokens: **8000** (measured with production `o200k_base` via `gpt-tokenizer`, plus documented chat-framing overhead)
- max output tokens: **800**
- UTF-16 unit prefilter: **64000** (DoS only — **not** a token or cost bound; JS `.length` is never treated as a tokenizer)
- reservation cost = server cost table at `(maxInputTokens, maxOutputTokens)` from the same envelope the tokenizer gate enforces before dispatch
- therefore, for any request allowed to reach the provider: independently measured billable input tokens ≤ reservation input-token ceiling, and `reservedCostMicros` ≥ server-estimated cost at the permitted token maxima
- this does **not** claim exact vendor-invoice reconciliation; the cost table remains an internal estimate
- model→vendor→encoding is enforced by `src/lib/ai/model-registry.ts` (not documentation-only): current verified mappings are `flux-fast`/`flux-standard` → `gpt-4o-mini` → `o200k_base` and `flux-advanced` → `gpt-4o` → `o200k_base`
- env may select only allowlisted vendor IDs verified for `o200k_base`; unsupported vendor IDs fail closed at config resolution (before dispatch)
- tokenizer refuses unverified internal keys / encodings rather than silently assuming `o200k_base`
- this does **not** claim `o200k_base` for arbitrary future OpenAI models; new vendor IDs require an explicit registry allowlist entry
- `reservedCostMicros` is internal accounting, **not** a vendor invoice
- environment variables may **lower** these limits; they cannot raise them above the envelope
- clients cannot raise the envelope
- requests over the envelope are rejected before provider dispatch (`not_dispatched` → RELEASE)

## Verified model/encoding registry

Server-enforced in `src/lib/ai/model-registry.ts`:

- Every internal model key resolves through one registry entry: vendor model ID + tokenizer encoding
- Provider dispatch, tokenization, and reservation cost all use that same verified metadata
- Current allowlisted vendor IDs: `gpt-4o-mini`, `gpt-4o` (both verified `o200k_base`)
- `AI_MODEL_FLUX_*` may only select from that allowlist; other values throw `AIProviderConfigError` (`not_dispatched`)
- Clients never choose vendor model ID, encoding, provider, or reservation amount

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

