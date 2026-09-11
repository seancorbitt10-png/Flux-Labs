# Implementation plan

## Process

Develop incrementally. Do not build the entire product in one pass.

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Inspect repository | **Done** |
| 1 | Foundation (shell, auth, DB, AI abstraction, entitlements, docs, tests) | **Done** |
| 2 | Student model + onboarding + knowledge foundation + Study experience | **Done** |
| 3 | Classes / tasks / calendar + academic AI context | **Done** |
| 4 | Production AI foundation + guided Study intelligence | **Architecture/planning complete — implementation NOT STARTED** |
| 5 | Resources / document intelligence | Planned |
| 6 | Study workflows / progress / mastery | Planned |
| 7 | Proactive agent | Planned |
| 8 | Integrations (modular LMS/calendar/drive) | Planned |
| 9 | Billing / controlled 7-day trial activation | Planned |
| 10 | Production hardening | Planned |

## Phase 1 — complete

Shipped and merged via PR #1:

- Next.js application shell with responsive navigation
- Auth.js credentials registration/login/logout
- PostgreSQL schema: users, profile, entitlements, trial, usage, AI interaction summary, audit log
- Trial entitlement provisioning + atomic reservation
- AI orchestration path with stub provider, router, academic policy
- Study page wired end-to-end
- Security hardening, CI, docs, tests

## Phase 2 — complete

Phase 2 established the student-specific academic foundation and the first learning-first Study experience.

### Student model and knowledge foundation

- Controlled StudentAttribute registry with one-active-key invariant
- Provenance and confidence semantics with server authority
- Student goals, observations, learning evidence, concept state, and misconceptions
- Subject → Topic → Concept knowledge foundation
- User-owned versus shared/global data ownership and deletion semantics
- Conservative mastery contract; no learning-style typology

### AI context and write boundary

- Controlled, read-only AI context assembly
- Current state separated from historical evidence
- Student content treated as untrusted data rather than instructions
- AI outputs treated as proposals rather than authoritative Student Model writes
- Confirmation-gated write-back boundary
- No premature concept resolution, RAG, or real provider dependency

### Onboarding and Study experience

- Server-controlled onboarding catalog and session lifecycle
- Session-bound student setup with authorized Student Model mapping
- Skip/resume/dismiss behavior
- Learning-first Study intents and multi-turn browser-session continuity
- Server-validated focus concepts
- Confirmation/rejection of AI proposals
- Entitlement-aware and failure-safe Study behavior

### Phase 2 quality status

All merged Phase 2 implementation slices passed their required quality gates at merge, including automated tests, typecheck, lint, build, and migration checks. Phase 2 intentionally retains the stub AI provider; real model providers remain Phase 4 work.

## Phase 3 — complete

Phase 3 architecture is in `docs/PHASE3_ARCHITECTURE.md`. All implementation slices are merged to `main`:

1. Academic workspace data foundation — **Merged (PR #10).**
2. Classes + Tasks UI — **Merged (PR #11).**
3. Calendar UI — **Merged (PR #12).**
4. Academic AI context integration — **Merged (PR #13).**

### Phase 3 delivered

- Student-owned Classes and Tasks with ownership/IDOR protection
- Calendar as read-side projection of dated academic records
- Mobile-first Classes / Tasks / Calendar UI
- Server-controlled academic workspace slice in `assembleAIContext`
- Optional Study focus (`classId` / `taskId`) with ownership validation
- Workspace text fenced as student_data (DATA), never instructions

### Phase 3 non-goals (honored)

Did not introduce real LLM providers, LMS integrations, billing, a generalized recommendation engine, RAG/embeddings, teacher/admin/parent systems, recurring class schedules, attendance, gradebook, notifications infrastructure, generic calendar events, or unrelated productivity features.

## Phase 4 — architecture / planning complete; implementation NOT STARTED

Phase 4 architecture is in `docs/PHASE4_ARCHITECTURE.md`.

### Chosen objective

**Production AI foundation (prerequisite slice) + guided Study intelligence** — the first real learning-first tutoring experience on the existing Study path.

### Explicit status

- Architecture / product planning: **complete** (this planning PR)
- Implementation slices: **NOT STARTED**
- No production feature code for Phase 4 yet
- No Phase 4 database migration yet
- Stub AI provider remains the runtime default until implementation slices ship

### Planned implementation slices (not started)

0. Production AI provider adapter (prerequisite)
1. Entitlement & cost hardening under real spend
2. Learning-first prompt & policy hardening for real models
3. Study focus UX (`classId` / `taskId`)
4. Guided tutoring loop UX
5. Meaningful proposal generation from tutoring
6. Optional PR #13 follow-up hardening (bounded queries / minimization)

See `docs/PHASE4_ARCHITECTURE.md` §19 for scope, deps, security, tests, and DoD per slice.

### Phase 4 non-goals

Do not add RAG/embeddings/vector DBs, spaced-repetition engines, multi-agent/autonomous agents, LMS/external calendar integrations, Stripe/billing implementation, teacher/parent/admin systems, massive document systems, or major unrelated UI redesigns as part of Phase 4.

### Phase 4 process

1. Architecture/design (this document set)
2. Independent review and corrections
3. Small implementation slices (separate PRs)
4. Tests + typecheck + lint + build (+ migration checks only if a slice introduces schema)
5. Independent review each slice
6. Merge only after review clearance

## Deferred roadmap

Later phases cover resources/document intelligence, progress/mastery workflows, proactive agent behavior, integrations, billing/trial activation, and production hardening. Those remain planned and are not started.

## Core assumptions

- Extend the existing relational foundation; do not replace it casually.
- Student context remains untrusted data in AI prompts; policy outranks context.
- Server owns identity, authorization, provenance, confidence, entitlements, and consequential writes.
- Avoid premature intelligence: do not add embeddings, RAG, keyword concept matching, or extra model calls without an approved product need.
- Build incrementally and keep deferred features out of implementation slices.
