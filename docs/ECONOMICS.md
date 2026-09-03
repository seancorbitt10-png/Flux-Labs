# Economics

## Targets (planning, not hard-coded assumptions)

- Gross margin: ~60%+ near term; design toward 70–80% where practical
- Trial AI/variable cost: ~≤ $1 average / trial user
- Trial max exposure envelope: ~$1.50–$2.00 / trial user

## Critical question

Can Flux recover acquisition + trial cost within the **first paid month** at acceptable gross margin?

Do **not** build around unlimited free AI.

## Instrumentation (Phase 1 foundation)

`usage_records` captures:

- capability / feature / task type
- internal model key
- tokens (when available)
- estimated cost micros
- latency / success

This enables future COGS-per-user / per-feature / per-trial analysis.

## Before expensive features

Estimate requests/user, tokens, model cost, retrieval/storage, worst-case, and plan placement.
