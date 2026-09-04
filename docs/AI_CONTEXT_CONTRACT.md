# AI Context Contract

**Status:** CONTRACT — design only; `assembleAIContext` not implemented
**Authority:** Subordinate to `docs/PHASE2_ARCHITECTURE.md` (human-approved)
**Related:** `docs/AI_WRITE_CONTRACT.md`, `docs/ENGINEERING_NON_NEGOTIABLES.md`, `docs/AI_SYSTEM.md`

---

## 1. Purpose

Define the exact conceptual contract for the future `assembleAIContext` layer:

> What may Flux know about *this authenticated student* for *this task*, and how must that knowledge be represented so it cannot override application policy?

This contract preserves:

| Distinction | Rule |
|-------------|------|
| Current state ≠ historical evidence | Current-state rows guide behavior; evidence/observation logs are history |
| AI inference ≠ authoritative student fact | INFERRED/HYPOTHESIS never presented as EXPLICIT |
| AI proposal ≠ automatic persistence | Context assembly **reads only**; writes use `AI_WRITE_CONTRACT.md` |

---

## 2. Scope

**In scope (future Phase 2 implementation):**

- Read-side selection and serialization of student + catalog context for AI orchestration
- Provenance-aware labeling in assembled context
- Budgets, minimization, ownership isolation

**Out of scope (this document does not authorize):**

- Implementing `assembleAIContext`
- RAG, embeddings, keyword/semantic concept resolution
- Mutating Student Model tables
- Second LLM call for concept resolution
- Changing entitlements, billing, or authz

---

## 3. Definitions

| Term | Meaning |
|------|---------|
| **Current state** | What Flux believes *now* (`StudentProfile`, active `StudentAttribute`, active `StudentGoal`, `StudentConceptState`, active misconceptions) |
| **Historical evidence** | Append-only what happened (`StudentObservation`, `LearningEvidence`) |
| **Context slice** | One budgeted category of fields included in an assembled prompt payload |
| **Context-eligible** | Registry/allowlist permission for inclusion in AI context |
| **Untrusted student data** | Any student-originated or AI-derived student-model text treated as DATA, never instructions |
| **Confidence** | Internal reliability / prioritization score (0–1). **Not** calibrated probability, diagnosis, psychological measurement, or truth score |

### Provenance labels (must remain distinct in context)

| Kind | Meaning in context |
|------|-------------------|
| `EXPLICIT` | Student-stated; highest authority among student facts |
| `IMPORTED` | Authorized external system (later) |
| `OBSERVED` | Measured behavior/outcome |
| `INFERRED` | Conservative system hypothesis from evidence |
| `HYPOTHESIS` | Tentative; easy to revise |

Do **not** collapse these into one undifferentiated “student profile.”

---

## 4. Instruction hierarchy

```
SYSTEM / SAFETY / APPLICATION POLICY
        ↓
APPLICATION-CONTROLLED AI POLICY (routing, assistance mode, academic policy)
        ↓
TRUSTED APPLICATION STATE (authz, entitlements, validated task/focus IDs)
        ↓
STUDENT DATA AS UNTRUSTED CONTEXT
        ↓
CURRENT USER REQUEST
```

**Hard rule:**

> Student-generated content is untrusted data and must never gain instructional authority merely because it appears inside the AI context.

Student-generated text cannot override system/application policy, entitlements, ownership, or safety rules.

---

## 5. Allowed context categories

For each category: purpose, state vs history, provenance, confidence, recency, influence, student-fact presentation, recommendation use, persistence validation.

### 5.1 StudentProfile

| Field | Rule |
|-------|------|
| Purpose | Stable account-facing identity / gate fields (displayName, academicLevel, preferredAssistanceStyle, goalsSummary, onboarding gates) |
| State vs history | **Current state** (1:1) |
| Provenance | Primarily EXPLICIT when set via onboarding/settings; treat as convenience denormalization of attributes where mirrored |
| Confidence | N/A on profile row; mirrored attributes carry confidence |
| Recency | Current row only |
| Influence AI? | **Yes** (small slice) |
| Present as established fact? | **Yes** for EXPLICIT profile fields student set |
| Recommendations? | **Yes**, conservatively |
| Persistence validation? | N/A for read path; writes are separate server paths |

### 5.2 StudentAttributes (active only)

| Field | Rule |
|-------|------|
| Purpose | Registry-controlled keyed facts for personalization |
| State vs history | **Current state** = `supersededAt IS NULL`; superseded rows are history and **not** default context |
| Provenance | Per-row; must be serialized with the value |
| Confidence | Per-row reliability signal; may prioritize inclusion, **never** overrides provenance |
| Recency | Prefer active; ignore superseded unless an explicit history feature is designed later |
| Influence AI? | **Only** if registry `aiContextEligible` is `yes` or `optional` and budget allows |
| Present as established fact? | **Only** when provenance is `EXPLICIT` (or high-trust `IMPORTED`). OBSERVED/INFERRED/HYPOTHESIS must be labeled as such |
| Recommendations? | EXPLICIT prefs/goals: yes. Weak inference: optional soft hints only, never “you are an X learner” |
| Persistence validation? | Read-only in assemble; attribute writes require registry + server authority |

### 5.3 StudentGoals

| Field | Rule |
|-------|------|
| Purpose | Active academic goals |
| State vs history | **Current state** (ACTIVE); ACHIEVED/ABANDONED excluded from default context |
| Provenance | Usually EXPLICIT |
| Confidence | Stored; prioritize ACTIVE EXPLICIT |
| Recency | Prefer recent / higher priority; budget max **3** |
| Influence AI? | **Yes** |
| Present as established fact? | **Yes** if EXPLICIT |
| Recommendations? | **Yes** |
| Persistence validation? | Read-only in assemble |

### 5.4 StudentObservations

| Field | Rule |
|-------|------|
| Purpose | Short behavioral/academic event summaries |
| State vs history | **Historical evidence** (append-only) |
| Provenance | Usually OBSERVED |
| Confidence | Reliability of the observation record, not a diagnosis |
| Recency | Prefer recent; budget max **3**; stale observations are not current truth |
| Influence AI? | **Yes**, as historical signals only |
| Present as established fact? | **No** — present as observed signals |
| Recommendations? | Soft only; cannot silently rewrite EXPLICIT prefs |
| Persistence validation? | Read-only in assemble |

### 5.5 LearningEvidence

| Field | Rule |
|-------|------|
| Purpose | Append-only evidence linked to concepts when known |
| State vs history | **Historical evidence** |
| Provenance | Via `kind` / `source` (e.g. TUTOR_SIGNAL ≠ EXPLICIT) |
| Confidence | Use `weight` + kind conservatively; not a truth score |
| Recency | Prefer recent for focus concepts; budget tight |
| Influence AI? | **Yes**, as evidence only |
| Present as established fact? | **No** |
| Recommendations? | Soft; **EVIDENCE ≠ MASTERY** |
| Persistence validation? | Read-only in assemble |

### 5.6 StudentConceptState

| Field | Rule |
|-------|------|
| Purpose | Current mastery label Flux believes *now* for a concept |
| State vs history | **Current state** |
| Provenance | Per-row; EXPLICIT self-report vs weaker system updates |
| Confidence | Reliability of the mastery *label*, not student worth |
| Recency | Prefer focus concepts; budget max **5** |
| Influence AI? | **Yes**, when concept is server-validated focus |
| Present as established fact? | Only EXPLICIT self-reports may be phrased firmly; otherwise label uncertainty |
| Recommendations? | **Yes**, with provenance caution |
| Persistence validation? | Read-only; mastery mutations follow write contract + mastery policy (deferred algorithm) |

### 5.7 StudentMisconceptions

| Field | Rule |
|-------|------|
| Purpose | Active misconceptions (optional Concept link) |
| State vs history | **Current state** when ACTIVE; RESOLVED/DISMISSED out of default context |
| Provenance | Often OBSERVED; EXPLICIT only via student settings channel |
| Confidence | Uncertainty required when not EXPLICIT |
| Recency | Prefer ACTIVE for confirmed relevant concepts; budget max **3** |
| Influence AI? | **Yes** for tutoring caution |
| Present as established fact? | **No** unless student EXPLICITLY confirmed |
| Recommendations? | Tutoring caution / checks; never permanent labels |
| Persistence validation? | Read-only in assemble; AI proposals ≠ fact |

### 5.8 Knowledge Catalog (Subject / Topic / Concept / ConceptRelation)

| Field | Rule |
|-------|------|
| Purpose | Ground tutoring in named concepts and minimal relations |
| State vs history | Catalog **current** definitions (global) |
| Provenance | SYSTEM catalog vs USER concepts |
| Confidence | N/A |
| Recency | Current catalog rows |
| Influence AI? | **Yes** for grounded explanation |
| Present as established fact? | Concept names/descriptions as curriculum vocabulary — not student traits |
| Recommendations? | Only with server-validated concept IDs |
| Persistence validation? | Read-only; USER concepts readable only by owner |

### 5.9 Current academic / session context

| Field | Rule |
|-------|------|
| Purpose | Validated focus for this request: `taskType`, assistance mode, optional server-validated `conceptIds` (later classId/taskId) |
| State vs history | Request-scoped **trusted application state** after server validation |
| Provenance | Application-controlled |
| Confidence | N/A |
| Recency | This request only |
| Influence AI? | **Yes** — higher than student history for focus |
| Present as established fact? | As session focus, not lifelong student identity |
| Recommendations? | **Yes** |
| Persistence validation? | Client-supplied IDs must be server-validated; reject forged foreign IDs |

---

## 6. Selection precedence (Phase 2)

Stop at budget (Appendix B of `PHASE2_ARCHITECTURE.md`):

1. Server-validated focus (`conceptIds`, later class/task)
2. Phase 3+ class/task context when available
3. **Not in Phase 2:** concept resolution from free text / keyword / embeddings / RAG
4. Active misconceptions for **confirmed** relevant concepts
5. High-confidence, context-eligible attributes (prefer EXPLICIT)
6. Active goals (max 3)
7. Recent observations / evidence (max 3 each, summaries only)
8. Stop

---

## 7. Conflict & staleness rules

| Situation | Rule |
|-----------|------|
| EXPLICIT vs OBSERVED/INFERRED/HYPOTHESIS conflict | Keep EXPLICIT as current state; history may note conflict; do **not** silently override in context presentation |
| Higher confidence number on weaker provenance | Confidence **cannot** outrank provenance |
| Old observation vs current attribute | Prefer current-state attribute; treat old observation as historical |
| Multiple active goals | Budget by priority/recency |
| MASTERED label without supporting policy | Do not invent mastery in assemble; only serialize stored ConceptState |

---

## 8. Serialization requirements

1. Structured, labeled fields (JSON-like or tagged sections) — **not** raw free-form dumps.
2. Each student fact includes provenance label where applicable.
3. Field-length limits enforced (Architecture Appendix B).
4. No raw chat transcripts automatically injected.
5. No secrets, password hashes, entitlement internals, IP hashes, or security audit payloads.
6. No client-supplied “extra context” blobs unless server-validated against an allowlist.
7. USER concepts: only owner-readable; never leak another user’s USER catalog rows.

Example shape (conceptual):

```text
[APPLICATION_POLICY] ...
[TRUSTED_FOCUS] conceptIds=[...] taskType=...
[STUDENT_EXPLICIT] academic.level=undergrad provenance=EXPLICIT
[STUDENT_OBSERVED] observation=... provenance=OBSERVED createdAt=...
[STUDENT_INFERRED] ... (if ever included) labeled INFERRED
[USER_MESSAGE] ...
```

---

## 9. Security / authorization

| Requirement | Rule |
|-------------|------|
| Ownership | Only authenticated user’s student-owned rows |
| Cross-user | Forbidden |
| Catalog | SYSTEM readable; USER concepts only if `createdByUserId === actor` |
| Client injection | Reject arbitrary client context/provenance/confidence |
| Secrets | Never include |
| Entitlements | May gate whether AI runs; do not dump billing internals into student context |

---

## 10. Uncertainty handling

- Serialize confidence only as an internal prioritization hint to the *application* policy layer when useful.
- Do **not** instruct the model to treat confidence as clinical, psychological, diagnostic, or probabilistic truth.
- Prefer wording like “student-stated” vs “observed signal” vs “uncertain hypothesis.”

---

## 11. `assembleAIContext` MUST NOT

- Create database records
- Mutate `StudentAttribute` / goals / concept state / misconceptions
- Declare mastery
- Rewrite provenance or confidence
- Change ownership / actor identity
- Infer arbitrary facts and persist them
- Call a second LLM for concept resolution
- Perform RAG / embeddings / vector search / keyword concept matching
- Perform hidden side effects (network fan-out, billing mutations, entitlement changes)
- Accept client-authored student “facts” as trusted without server verification

Context assembly is a **pure read + serialize** step relative to the Student Model.

---

## 12. Explicit non-goals

- Full prompt-injection research stack
- Dumping entire student history
- Learning-style typology in context
- Presenting weak inference as identity

---

## 13. Open questions

None that reopen approved architecture. Implementation of budgets may tune numeric caps without changing semantics.

**OPEN DECISION REQUIRED:** None for this contract.
