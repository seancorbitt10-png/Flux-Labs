# Implementation plan

## Process

Develop incrementally. Do not build the entire product in one pass.

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Inspect repository | **Done** |
| 1 | Foundation (shell, auth, DB, AI abstraction, entitlements, docs, tests) | **Done** (merged to `main` @ `e1dc1d0`) |
| 2 | Student model + onboarding + knowledge foundation | **Design complete** — implementation not started |
| 3 | Classes / tasks / calendar | Planned |
| 4 | Core AI tutoring (real providers, guided flows) | Planned |
| 5 | Resources / document intelligence | Planned |
| 6 | Study workflows / progress / mastery | Planned |
| 7 | Proactive agent | Planned |
| 8 | Integrations (modular LMS/calendar/drive) | Planned |
| 9 | Billing / controlled 7-day trial activation | Planned |
| 10 | Production hardening | Planned |

## Phase 1 (complete)

Shipped and merged via PR #1:

- Next.js application shell with responsive navigation
- Auth.js credentials registration/login/logout
- PostgreSQL schema: users, profile, entitlements, trial, usage, AI interaction summary, audit log
- Trial entitlement provisioning + atomic reservation
- AI orchestration path with stub provider, router, academic policy
- Study page wired end-to-end
- Security hardening, CI, docs, tests (22 passing at merge)

## Phase 2

### Design

Full design recorded in **[PHASE2_ARCHITECTURE.md](./PHASE2_ARCHITECTURE.md)**.

Includes: Student Model, evolution/provenance, onboarding (≤30 Q), Knowledge Foundation (Subject→Topic→Concept), student↔knowledge, AI context assembly, proposed Prisma models, privacy, implementation layers, non-goals, Definition of Done.

### Implementation

**Not started.** Awaiting design review / implementation prompt.

Do not begin schema migrations or UI until explicitly approved.

## Assumptions

- Phase 2 extends Phase 1 relational foundation; does not replace auth/entitlements/orchestration.
- Concepts are global catalog entities; classes join later (Phase 3).
- No learning-style typology; evidence + provenance only.
- Stub AI remains acceptable through Phase 2; real providers are Phase 4.
