# Testing

## Stack

- Vitest for unit tests
- Focus on security boundaries and policy/entitlement logic — not only happy paths

## Phase 1 coverage

- Academic assistance policy decisions
- AI task routing
- Plan limit helpers
- Error sanitization
- Entitlement reservation (limits, missing trial, expiry, concurrency)
- Request summary redaction / capability mapping

## Later

- Auth + user isolation integration tests
- File access controls
- Prompt injection cases
- Critical UI workflows

## Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

CI runs these on PRs via `.github/workflows/ci.yml` (Postgres service).
