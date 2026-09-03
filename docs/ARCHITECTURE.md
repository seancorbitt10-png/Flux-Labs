/**
 * Phase 0 / Phase 1 architecture assessment and system design.
 */

# Architecture — Flux Labs

## Phase 0 assessment (2026-09-03)

### Repository state

The repository was effectively **greenfield**:

- Single commit with a placeholder `README.md`
- No application code, framework, database, auth, tests, or CI

### Decision

Bootstrap **Phase 1 foundation** using the stated technology defaults:

| Layer | Choice | Rationale |
|-------|--------|-----------|
| App | Next.js 15 (App Router) + React 19 + TypeScript | Modern full-stack defaults, server-first security |
| UI | Tailwind CSS 4 | Fast, minimal black/white academic UI |
| DB | PostgreSQL + Prisma 6 | Relational model for student/academic data |
| Auth | Auth.js (next-auth v5) credentials | Server sessions, Prisma adapter-ready, OAuth later |
| AI | Provider-agnostic orchestration + stub provider | No scattered model calls; real providers in Phase 4 |
| Tests | Vitest | Fast unit tests for policy, routing, entitlements |

Nothing meaningful needed preservation beyond the repo identity.

---

## High-level system

```
Client (Next.js UI)
    ↓ server actions / route handlers
Auth.js (session)
    ↓
Authorization + Entitlement check
    ↓
AI Orchestration (route → policy → context → provider)
    ↓
Usage logging + student evidence hooks (later)
    ↓
PostgreSQL (Prisma)
```

## Module map (Phase 1)

```
src/
  app/               # Routes: landing, auth, app shell pages, API
  components/        # UI + layout + study chat
  lib/
    auth/            # Auth.js config, session helpers, actions
    ai/              # types, provider, router, policy, orchestration
    entitlements/    # plan config, checks, usage recording
    db/              # Prisma client
    validation/      # Zod schemas
    errors.ts        # Sanitized error types
  middleware.ts      # Auth gate for app routes
prisma/              # Schema + migrations
docs/                # Living architecture docs
tests/               # Unit tests
```

## Design principles encoded now

1. **Learning-first** — `lib/ai/policy.ts` chooses assistance mode centrally.
2. **Server-side entitlements** — `lib/entitlements/*`; UI never enforces limits alone.
3. **Provider-agnostic AI** — `AIProvider` interface; stub in Phase 1.
4. **Cost-aware** — usage records store tokens + estimated micros; trial budget soft-cap.
5. **Structured student data** — `StudentProfile` table now; evidence models later (not a JSON blob).
6. **Privacy-aware telemetry** — usage logs avoid storing full educational content.

## What Phase 1 deliberately excludes

- Full onboarding questionnaire (Phase 2)
- Classes / tasks / calendar CRUD (Phase 3)
- Real AI providers & streaming tutoring UX (Phase 4)
- Document upload/RAG (Phase 5)
- Progress/mastery engine (Phase 6)
- Proactive agent (Phase 7)
- LMS connectors (Phase 8)
- Stripe/billing activation (Phase 9)
- Production hardening sign-off (Phase 10)

## Trust boundaries

- Client is untrusted.
- Uploaded/retrieved document content (future) is untrusted input, never system instruction.
- AI output cannot override authz/entitlement rules.
- Resource access must always verify `userId` ownership (helpers in `lib/auth/session.ts`).

## Scalability notes

- Plan limits are **config** (`plans.ts`), not hard-coded UI constants.
- Model routing uses internal keys (`flux-fast|standard|advanced`), not vendor names in product UI.
- Integration abstraction is deferred to Phase 8; core domain remains LMS-agnostic.
