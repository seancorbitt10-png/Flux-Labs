# Security

## Non-negotiables

- Never trust the client for authz or entitlements
- Protect against IDOR via ownership checks (`assertResourceOwner`)
- Sanitize user-facing errors (`toClientError`)
- Secrets only on server (`AUTH_SECRET`, future provider keys)
- Rate limiting on auth + AI entrypoints (in-memory Phase 1)
- Uploaded documents (Phase 5) are untrusted
- Prompt injection defenses: retrieved content ≠ system instructions
- AI text cannot override security rules

## Phase 1 controls

| Control | Implementation |
|---------|----------------|
| Authentication | Auth.js credentials + JWT session |
| Route protection | `middleware.ts` (single source of truth) + layout `auth()` |
| Password storage | bcrypt cost 12; max length 72 (bcrypt limit) |
| Login timing | Dummy bcrypt compare when user/hash missing |
| Registration | Atomic user+profile+trial; no email enumeration |
| Input validation | Zod on auth + AI inputs |
| Entitlements | Server `reserveCapability` (conditional update, race-safe) |
| Rate limiting | In-memory on login/register/AI |
| Error sanitization | `AppError` / `toClientError` |
| API unauthenticated | JSON 401 for `/api/*` (not HTML login redirect) |
| Security headers | CSP / frame-deny / nosniff via `next.config.ts` |
| AI logs | Request summaries hashed (`sha256…:len=N`), not raw content |
| Audit | `AuditLog` on registration |

## Not yet production-complete

- Distributed rate limiting (Redis) / account lockout / MFA
- Full abuse / prompt-injection pen test
- External security review
- COPPA parental flows

Do **not** treat this document as a compliance certification.
