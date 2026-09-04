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

## Phase 2 (foundation slice #1 — persistence/domain implemented)

Canonical design: **[PHASE2_ARCHITECTURE.md](./PHASE2_ARCHITECTURE.md)**.

**Implemented (server/domain foundation, not full Phase 2 product):**

- Prisma models + migration for student-owned tables and knowledge catalog
- Partial unique index `student_attribute_one_active_per_key` (`UNIQUE(userId, key) WHERE supersededAt IS NULL`)
- Server-controlled attribute registry (`src/lib/student/attribute-registry.ts`) + atomic supersede
- Onboarding question catalog + session/answer service (`src/lib/onboarding/`)
- Goals, observations, evidence, concept state, misconceptions, educational-data deletion services
- Ownership checks via authenticated actor (`assertResourceOwner`); catalog retained on educational wipe

**Still deferred:** onboarding UI, `assembleAIContext` wiring, knowledge seed UI, mastery algorithms, MisconceptionEvidence join, keyword/semantic concept resolution.

## Later (Phase 3+)

- Class / Enrollment / Task joins to concepts
- Richer progress UI
- Outcome-driven mastery updates from real tutoring
