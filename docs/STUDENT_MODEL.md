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
| Confidence | How strongly we trust it |
| Source + time | Provenance |

Weak inferences must not permanently define the student.  
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
- Add provenance-aware `StudentAttribute`, `StudentGoal`
- Add append-only `StudentObservation` + `LearningEvidence`
- Add shared catalog `Subject` → `Topic` → `Concept` (+ minimal relations)
- Add `StudentConceptState` + `StudentMisconception`
- Add resumeable onboarding session/answers
- Add budgeted `assembleAIContext` between Student Model / Knowledge / Orchestration

## Later (Phase 3+)

- Class / Enrollment / Task joins to concepts
- Richer progress UI
- Outcome-driven mastery updates from real tutoring
