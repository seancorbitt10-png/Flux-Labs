# Student model

## Philosophy

Personalization must be based on **evidence**, not learning-style stereotypes.

Distinguish:

| Kind | Meaning |
|------|---------|
| Explicit | Student stated it |
| Observed | Measured behavior/outcomes |
| Inferred | Model hypothesis |
| Confidence | How strongly we trust it |
| Source + time | Provenance |

Weak inferences must not permanently define the student.

## Phase 1

`StudentProfile` holds:

- displayName
- academicLevel (nullable)
- timezone
- onboardingCompletedAt
- preferredAssistanceStyle
- goalsSummary

Created empty-ish on registration; filled in Phase 2 onboarding.

## Later structure (not all tables yet)

- AcademicContext / Enrollment / Class
- StudentGoals
- LearningEvidence
- Topic / TopicMastery
- Misconception
- PerformanceHistory
- StudyBehavior
- Recommendations

Prefer relational tables with optional JSON metadata over one unstructured blob.
