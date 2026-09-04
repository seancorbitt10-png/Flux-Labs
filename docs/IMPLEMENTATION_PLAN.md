# Implementation plan

## Process

Develop incrementally. Do not build the entire product in one pass.

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Inspect repository | **Done** |
| 1 | Foundation (shell, auth, DB, AI abstraction, entitlements, docs, tests) | **Done** (merged to `main` @ `e1dc1d0`) |
| 2 | Student model + onboarding + knowledge foundation | **Design finalized for review** (correction pass) — implementation not started |
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

Full design recorded in **[PHASE2_ARCHITECTURE.md](./PHASE2_ARCHITECTURE.md)** (final architecture-review correction pass; still documentation only).

Includes: controlled StudentAttribute registry; one-active-key invariant; provenance/confidence semantics; conservative mastery contract; onboarding question registry (≤30 Q; no consent question); Knowledge Foundation; untrusted AI context assembly (no premature keyword intelligence); deletion/ownership semantics; testing requirements; non-goals; Definition of Done.

### Implementation

**Not started.** Awaiting **final** design approval / implementation prompt.

Do not begin schema migrations or UI until explicitly approved.

When implementation is approved, Phase 2 **must define and test ownership/cascade behavior for user-owned educational data** — this is a requirement, not a TODO/stub:

**User-owned (delete / cascade with ownership):**
`StudentProfile`, `StudentAttribute`, `StudentGoal`, `OnboardingSession`, `OnboardingAnswer`, `StudentObservation`, `LearningEvidence`, `StudentConceptState`, `StudentMisconception`, and future student-owned relations.

**Shared/global catalog (retain):**
`Subject`, `Topic`, SYSTEM `Concept`, SYSTEM `ConceptRelation`.

**Operational (separate policy):**
`UsageRecord`, `AIInteraction`, `AuditLog` — final retention/anonymization subject to product/legal policy review; do not claim all operational records must be deleted.

See `docs/PHASE2_ARCHITECTURE.md` §9 / §11 layer 2.8 / §12 DELETION.

### Assumptions

- Phase 2 extends Phase 1 relational foundation; does not replace auth/entitlements/orchestration.
- Concepts are global catalog entities; classes join later (Phase 3).
- No learning-style typology; evidence + provenance only; confidence is a reliability score, not probability.
- Student context is untrusted data in prompts; policy outranks context.
- Stub AI remains acceptable through Phase 2; real providers are Phase 4.
