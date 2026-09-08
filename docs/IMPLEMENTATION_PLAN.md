# Implementation plan

## Process

Develop incrementally. Do not build the entire product in one pass.

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Inspect repository | **Done** |
| 1 | Foundation (shell, auth, DB, AI abstraction, entitlements, docs, tests) | **Done** |
| 2 | Student model + onboarding + knowledge foundation + Study experience | **Done** |
| 3 | Classes / tasks / calendar | **Next** |
| 4 | Core AI tutoring (real providers, guided flows) | Planned |
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

## Phase 3 — Classes / Tasks / Calendar

Phase 3 is the next implementation phase. Before coding, produce and review a concrete architecture/design for:

- Classes and class ownership
- Tasks/assignments and their lifecycle/status
- Due dates and calendar representation
- Relationships between classes, tasks, concepts, and the Student Model
- Study context derived from classes/tasks without bypassing AI context controls
- Server-side authorization and IDOR protection
- Validation, deletion/cascade semantics, and audit considerations
- Mobile-first UI boundaries for Classes, Tasks, and Calendar
- Testing and Definition of Done

### Phase 3 non-goals

Do not introduce real LLM providers, LMS integrations, billing, a generalized recommendation engine, RAG/embeddings, teacher/admin/parent systems, or unrelated productivity features as part of Phase 3 unless the architecture review explicitly changes scope.

### Phase 3 process

1. Architecture/design
2. Independent review and corrections
3. Implementation in small slices
4. Tests + typecheck + lint + build + migration checks
5. Independent review of each slice
6. Merge only after review clearance

## Deferred roadmap

Phase 4 introduces real AI providers and guided tutoring. Later phases cover resources/document intelligence, progress/mastery workflows, proactive agent behavior, integrations, billing/trial activation, and production hardening.

## Core assumptions

- Extend the existing relational foundation; do not replace it casually.
- Student context remains untrusted data in AI prompts; policy outranks context.
- Server owns identity, authorization, provenance, confidence, entitlements, and consequential writes.
- Avoid premature intelligence: do not add embeddings, RAG, keyword concept matching, or extra model calls without an approved product need.
- Build incrementally and keep deferred features out of implementation slices.