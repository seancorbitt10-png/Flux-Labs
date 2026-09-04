# Student model

## Philosophy

Personalization must be based on **evidence**, not learning-style stereotypes.

Distinguish:

| Kind | Meaning |
|------|---------|
| Explicit | Student stated it |
| Imported | Came from an authorized external system |
| Observed | Measured behavior/outcomes |
| Inferred | Model hypothesis |
| Hypothesis | Tentative, easily revised |
| Confidence | Internal reliability / prioritization score — **not** a calibrated probability, diagnosis, or truth override |
| Source + time | Provenance (outranks confidence numbers) |

Weak inferences must not permanently define the student.  
High-confidence explicit facts must not be silently overwritten by weaker observed/inferred signals.  
Do **not** use visual/auditory/kinesthetic “learning styles.”

## Phase 1 (shipped)

`StudentProfile` holds:

- displayName
- academicLevel (nullable)
- timezone
- onboardingCompletedAt
- preferredAssistanceStyle
- goalsSummary

Created empty-ish on registration; filled in Phase 2 onboarding.

## Phase 2 (design — not implemented)

See **[PHASE2_ARCHITECTURE.md](./PHASE2_ARCHITECTURE.md)** for the full design.

Summary:

- Keep `StudentProfile` as the stable 1:1 account-facing profile
- `StudentAttribute` is a **typed, registry-controlled** key/value system (not an arbitrary profile store); one active value per user+key
- Add `StudentGoal`, append-only `StudentObservation` + `LearningEvidence`
- Add shared catalog `Subject` → `Topic` → `Concept` (+ minimal relations)
- Add `StudentConceptState` + `StudentMisconception` (no relational IDs in metadata JSON)
- Mastery contract: no `response → model → MASTERED`; evidence ≠ automatic mastery
- Server-validated onboarding catalog (≤30 Q); privacy notice ≠ legal consent; no consent question in onboarding
- Budgeted `assembleAIContext`; student context is **untrusted data** under system/policy precedence
- Defined ownership/deletion semantics for user-owned educational data (required + tested in Phase 2 implementation — not a TODO); catalog retained; operational retention separate

## Later (Phase 3+)

- Class / Enrollment / Task joins to concepts
- Richer progress UI
- Outcome-driven mastery updates from real tutoring
