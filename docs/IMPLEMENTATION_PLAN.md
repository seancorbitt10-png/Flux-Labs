# Implementation plan

## Process

Develop incrementally. Do not build the entire product in one pass.

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Inspect repository | Done |
| 1 | Foundation (shell, auth, DB, AI abstraction, entitlements, docs, tests) | **In progress** |
| 2 | Student model + onboarding | Next |
| 3 | Classes / tasks / calendar | Planned |
| 4 | Core AI tutoring (real providers, guided flows) | Planned |
| 5 | Resources / document intelligence | Planned |
| 6 | Study workflows / progress / mastery | Planned |
| 7 | Proactive agent | Planned |
| 8 | Integrations (modular LMS/calendar/drive) | Planned |
| 9 | Billing / controlled 7-day trial activation | Planned |
| 10 | Production hardening | Planned |

## Phase 1 scope (this delivery)

### Included

- Next.js application shell with responsive navigation
- Auth.js credentials registration/login/logout
- PostgreSQL schema: users, profile, entitlements, trial, usage, AI interaction summary, audit log
- Trial entitlement provisioning on signup
- AI orchestration path with stub provider, router, academic policy
- Study page wired to orchestration + usage logging
- Sanitized errors, Zod validation, middleware auth gate
- Documentation set + Vitest foundation

### Explicitly not included

- Real LLM provider calls
- Onboarding questionnaire
- Class/task/calendar CRUD
- File uploads
- Payment provider
- LMS connectors

## Recommended next phase

**Phase 2 — Student model + onboarding**

- 20–30 question onboarding (non-psychometric)
- Structured preferences, goals, academic context fields
- Explicit vs observed vs inferred provenance fields
- Onboarding → `StudentProfile` persistence
- Feed onboarding context into AI orchestration

## Assumptions

- Credentials auth is acceptable for Phase 1; OAuth providers can be added without redesign.
- Stub AI is honest in-product (Study shows guided stub responses) — not a fake “smart” demo.
- Trial limits in `plans.ts` are experimental and configurable.
- PostgreSQL is the system of record from day one (no SQLite production path).
