# Flux Labs

AI-powered academic operating system for students.

Flux Labs is a persistent academic intelligence layer — not a homework chatbot, LMS replacement, or generic AI wrapper. It helps students plan, learn, study, and improve over time with learning-first assistance.

## Current phase

**Phase 1 — Foundation** (this branch)

- Next.js App Router + TypeScript + Tailwind
- Auth.js (credentials) with Prisma + PostgreSQL
- App shell + navigation (Home, Classes, Tasks, Calendar, Study, Resources, Progress, Settings)
- Student profile stub, trial entitlement provisioning
- Provider-agnostic AI orchestration (stub provider)
- Server-side entitlement / usage accounting
- Architecture documentation + unit tests

## Quick start

```bash
# Requires PostgreSQL
cp .env.example .env.local
# set DATABASE_URL and AUTH_SECRET

npm install
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest unit tests |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:studio` | Prisma Studio |

## Documentation

See `/docs`:

- `ARCHITECTURE.md` — system design
- `PRODUCT.md` — product vision & principles
- `IMPLEMENTATION_PLAN.md` — phased delivery
- `AI_SYSTEM.md` — orchestration, routing, policy
- `STUDENT_MODEL.md` — persistent student model
- `SECURITY.md` / `PRIVACY.md` — security & education data
- `BILLING.md` / `ECONOMICS.md` — entitlements & cost targets
- `ENVIRONMENT.md` / `TESTING.md` / `INTEGRATIONS.md`

## Important

- Meaningful entitlement checks are **server-side only**
- Students do **not** choose underlying AI models
- Learning-first policy lives in a **central** assistance engine
- Do not claim legal compliance from code alone
