# Privacy

Flux Labs is an education product and may eventually serve minors.

## Design intent

- Data minimization
- Purpose limitation (academic assistance)
- User isolation
- Ownership/deletion for user-owned educational data is a **Phase 2 implementation requirement with tests** (see `docs/PHASE2_ARCHITECTURE.md` §9) — not a documentation TODO
- Clear separation of operational telemetry vs educational content

## Data collected in Phase 1

| Data | Why | Where |
|------|-----|-------|
| Email, name, password hash | Account | `users` |
| Display name, prefs stubs | Personalization foundation | `student_profiles` |
| Entitlement / trial counters | Access control & cost | `entitlements`, `trials` |
| Usage metrics (tokens, cost, feature) | Economics & limits | `usage_records` |
| AI request summary (truncated) | Debugging / quality | `ai_interactions` |
| Audit events | Security | `audit_logs` |

## Access

Only the owning authenticated user (and future authorized school/parent roles under explicit agreements).

## Legal

**Code does not equal compliance.** COPPA, FERPA, GDPR, and state student-privacy obligations require professional legal review before production launch serving minors/schools.
