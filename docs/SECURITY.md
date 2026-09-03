# Security

## Non-negotiables

- Never trust the client for authz or entitlements
- Protect against IDOR via ownership checks (`assertResourceOwner`)
- Sanitize user-facing errors (`toClientError`)
- Secrets only on server (`AUTH_SECRET`, future provider keys)
- Rate limiting & abuse controls expand in later phases
- Uploaded documents (Phase 5) are untrusted
- Prompt injection defenses: retrieved content ≠ system instructions
- AI text cannot override security rules

## Phase 1 controls

| Control | Implementation |
|---------|----------------|
| Authentication | Auth.js credentials + JWT session |
| Route protection | `middleware.ts` + server layout `auth()` |
| Password storage | bcrypt (cost 12) |
| Input validation | Zod on auth + AI inputs |
| Entitlements | Server `assertCapabilityAllowed` |
| Error sanitization | `AppError` / `toClientError` |
| Audit | `AuditLog` on registration |

## Not yet production-complete

- Account lockout / MFA
- Full rate limiting middleware
- Pen test / external review
- COPPA parental flows

Do **not** treat this document as a compliance certification.
