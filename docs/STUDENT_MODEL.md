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
| Confidence | Internal reliability / prioritization score — **not** a calibrated probability |
| Source + time | Provenance |

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
- Add provenance-aware `StudentAttribute` (server-side **attribute registry**; one active value per user+key) and `StudentGoal`
- Add append-only `StudentObservation` + `LearningEvidence`
- Add shared catalog `Subject` → `Topic` → `Concept` (+ minimal relations)
- Add `StudentConceptState` + `StudentMisconception` (no evidence-ID arrays in JSON metadata)
- Conservative mastery boundary: evidence recording ≠ automatic MASTERED from one signal
- Add resumeable onboarding session/answers with server-side validation (privacy notice ≠ legal consent)
- Add budgeted `assembleAIContext`; student context is **untrusted data**

## Later (Phase 3+)

- Class / Enrollment / Task joins to concepts
- Richer progress UI
- Outcome-driven mastery updates from real tutoring
