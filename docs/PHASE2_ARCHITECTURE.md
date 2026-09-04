# Phase 2 Architecture Design

**Status:** DESIGN ONLY — not implemented  
**Baseline:** `origin/main` @ `e1dc1d016eb3ee9329250933a7f995b185141c15` (Phase 1 tip `d98b388`)  
**Branch:** `cursor/phase2-architecture-design-399a`  
**Date:** 2026-09-04  
**Revision:** Final architecture-review correction pass (documentation only; core model unchanged)

This document is the Phase 2 design deliverable. It does **not** authorize schema migrations, UI implementation, or application behavior changes until an explicit implementation prompt is approved.

Core architecture preserved after review:

```
User → StudentProfile / StudentAttribute / StudentGoal /
       StudentObservation / LearningEvidence /
       StudentConceptState / StudentMisconception

Knowledge: Subject → Topic → Concept

Learning loop: Acquire → Understand → Organize → Connect →
               Retrieve → Apply → Evaluate → Refine

Current state = what Flux currently believes
Evidence history = what has happened
New signal → evidence/observation → evaluation → current-state update
```

---

## 1. Current Phase 1 baseline (what we extend)

### Already established (do not duplicate)

| Area | What exists | Phase 2 role |
|------|-------------|--------------|
| Auth / user isolation | Auth.js, `requireUserId`, middleware, ownership helpers | All new student/knowledge data owned by `userId` |
| `User` | Account identity | Parent of student model |
| `StudentProfile` | Thin profile: displayName, academicLevel, timezone, onboardingCompletedAt, preferredAssistanceStyle, goalsSummary | **Keep** as stable account-facing profile; extend carefully |
| Entitlements / trial | Atomic `reserveCapability`, usage accounting | Unchanged; onboarding is not AI-billable |
| AI orchestration | Auth → reserve → route → policy → context → provider → usage | Add **context assembly** + optional **evidence write-back hooks** |
| `AIInteraction` / `UsageRecord` | Operational telemetry (hashed summaries, costs) | Remain operational; learning evidence is separate |
| `AuditLog` | Security/audit events | Use for onboarding complete, profile corrections, deletions |
| Docs / CI / tests | Architecture docs, 22 tests, green CI | Extend docs + add Phase 2 tests in implementation |

### Explicit Phase 1 gaps Phase 2 fills

- No structured onboarding
- No provenance (explicit vs observed vs inferred)
- No knowledge/concept catalog
- No mastery / misconception / evidence tables
- Orchestration only injects a few `StudentProfile` strings

### Design principle for Phase 2

**Extend relational structure.** Prefer small typed tables over one giant student JSON blob. Prefer append-only evidence with revisable current state. Optional metadata JSON is only for **auxiliary non-relational** fields — never for primary database relationships or ID arrays.

---

## 2. Student Model architecture

### Mental model

```
User
 └── StudentProfile          (stable, account-facing, mostly explicit)
 └── StudentAttribute[]      (keyed facts with provenance + confidence)
 └── StudentGoal[]           (goals with status)
 └── StudentObservation[]    (append-only behavioral/academic events)
 └── LearningEvidence[]      (append-only evidence linked to concepts when known)
 └── StudentConceptState[]   (current mastery/confidence per concept)
 └── StudentMisconception[]  (active/resolved misconception records)
```

### What the Student Model represents

| Domain | Representation | Notes |
|--------|----------------|-------|
| Academic context | Attributes + (Phase 3) Class/Enrollment | Phase 2: level, subjects of interest, self-reported courses as text attributes |
| Goals | `StudentGoal` | Explicit; revisable |
| Interests | Attributes (`interest.*`) | Explicit + later observed |
| Preferences | Profile fields + Attributes (`pref.*` / `preference.*`) | Assistance style, explanation length, pace tolerance; keys must be registry-allowlisted |
| Prior knowledge | Attributes + ConceptState | Self-report then evidence |
| Strengths / weaknesses | ConceptState + Observations | Evidence-weighted, not permanent labels |
| Misconceptions | `StudentMisconception` | Linked to Concept when possible |
| Study behavior | Observations (`study.*`) | Frequency, session length signals later |
| Effective approaches | Attributes (`approach.*`) with low initial confidence | Updated from outcomes, never fixed “learning style” |

### Forbidden personalization model

Do **not** store or ask for:

- Visual / auditory / kinesthetic learner types
- Fixed personality typology as product truth
- Permanent immutable labels from weak AI inference

### Provenance taxonomy (required on mutable beliefs)

| Kind | Meaning | Who writes | Default confidence |
|------|---------|------------|--------------------|
| `EXPLICIT` | Student stated it | Onboarding / settings | High (0.8–1.0) |
| `IMPORTED` | External system (LMS later) | Integrations | Medium–high with source |
| `OBSERVED` | Measured behavior/outcome | System from interactions | Medium (0.4–0.7) |
| `INFERRED` | Hypothesis from evidence | System (conservative) | Low–medium (≤0.5) |
| `HYPOTHESIS` | Tentative, easy to revise | System / tutor policy | Low (≤0.3) |

Every stored belief that can personalize AI behavior should carry:

- `provenance`
- `confidence` (0.0–1.0) — see §3: **internal reliability score, not calibrated probability**
- `source` (e.g. `onboarding`, `study_session`, `settings`)
- `createdAt` / `updatedAt`
- optional `supersededAt` / `supersededById` when revised

Weak inferences must not overwrite high-confidence explicit facts without clear rules (see §3).

### StudentAttribute registry (required)

**StudentAttribute is a typed, registry-controlled key/value system, not an arbitrary user-defined profile store.**

`StudentAttribute.key` is **server-controlled**. Clients never invent keys or write attribute rows directly.

`StudentAttribute` must **not** become an unrestricted profile blob or free-form JSON bag.

Flux maintains a **concrete server-side attribute registry** (versioned code config). Attribute keys are **allowlisted** by that configuration. Expanding the set of keys requires a registry change — never client-supplied key strings.

**Clients cannot:**

- invent attribute keys
- choose `provenance`
- choose `confidence`
- choose `source` / authority classification
- directly write arbitrary `StudentAttribute` records (including arbitrary `valueJson`)

**The server alone** determines keys, value validation, provenance, confidence, and source from the authenticated flow and registry rules.

For **each** supported registry key, the server defines:

| Registry field | Meaning |
|----------------|---------|
| value type / schema | scalar, enum, string, number, boolean, or structured JSON **only if declared** |
| validation / size constraints | max length, max items, allowed enums — enforced server-side |
| multi-value? | yes/no |
| permitted writers | onboarding, settings, system (observation), AI inference (usually **none** in Phase 2) |
| AI-context eligibility | whether `assembleAIContext` may include it |

**JSON storage rule:** `valueJson` may remain the storage representation for structured attributes, but **only** where the registry explicitly permits structured JSON and defines its schema. Arbitrary free-form JSON is rejected even though the column type is Json.

#### Phase 2 starter attribute registry (implementation-oriented)

Small starter set — do **not** invent dozens of keys. Add keys only by updating this registry.

| Key | Value type / constraints | Permitted writer(s) | Server-set provenance | AI context |
|-----|--------------------------|---------------------|-----------------------|------------|
| `academic.level` | enum string (fixed set) | onboarding, settings | EXPLICIT | yes |
| `academic.subjects` | string[] (max items + max len each) | onboarding, settings | EXPLICIT | yes |
| `interest.primary` | string (max len) | onboarding, settings | EXPLICIT | yes |
| `interest.secondary` | string (max len) | onboarding, settings | EXPLICIT | optional |
| `pref.explanation_length` | enum (`concise` \| `detailed`) | onboarding, settings | EXPLICIT | yes |
| `pref.guided_participation` | boolean | onboarding, settings | EXPLICIT | yes |
| `pref.assistance_style` | enum (fixed set) | onboarding, settings | EXPLICIT | yes |
| `habit.typical_weekly_time` | enum band | onboarding, settings | EXPLICIT | yes |
| `challenge.primary` | string (max len) | onboarding, settings | EXPLICIT | yes |
| `approach.worked_example` | boolean | settings; system later | EXPLICIT or OBSERVED | optional; never “learning style” |

Every key above is registered with type, validation, writers, and context eligibility. Unregistered keys are rejected.

### One active attribute per user + key (invariant)

**Invariant (required):** For every `(userId, key)`, at most one `StudentAttribute` may have `supersededAt IS NULL`.

Preferred database implementation (later — **do not create now**):

```
UNIQUE(userId, key)
WHERE supersededAt IS NULL
```

as a PostgreSQL **partial unique index**, for example:

```sql
CREATE UNIQUE INDEX student_attribute_one_active_per_key
  ON "StudentAttribute" ("userId", "key")
  WHERE "supersededAt" IS NULL;
```

If Prisma cannot express this directly in `schema.prisma`, implementation **must** add it via a SQL migration. Prefer **both** the DB constraint and a transactional service-layer supersede.

Application write path (atomic / transactional):

```
BEGIN
  supersede previous current attribute (set supersededAt, optional supersededById)
  create replacement current attribute (supersededAt NULL; server-assigned provenance)
COMMIT
```

Do **not** allow concurrent writes to create multiple current values for the same `(userId, key)`.

This invariant is required in: model definition (§8), settings/onboarding write paths (§9), and ATTRIBUTE SECURITY tests (§12).

### Decision: keep `StudentProfile`

**Keep `StudentProfile` as the 1:1 stable profile** (identity-adjacent UX fields + onboarding gate).

Do **not** dump dynamic mastery/evidence into it.

Extend only with fields that are:

- singular per student
- primarily explicit
- frequently needed in UI / authz gates

Candidates to add in implementation (not now):

- `onboardingVersion` (string/int)
- `onboardingSkippedAt` (nullable)
- maybe `primarySubjectFocus` — **prefer Attribute instead** to avoid profile bloat

`goalsSummary` / `preferredAssistanceStyle` remain for backward compatibility; Phase 2 should also mirror them into `StudentAttribute` / `StudentGoal` for provenance, then treat Profile fields as denormalized convenience.

---

## 3. Student Model evolution

### Two layers

1. **Current state** — what Flux believes *now* (`StudentAttribute`, `StudentGoal`, `StudentConceptState`, active misconceptions)
2. **Evidence log** — what happened (`StudentObservation`, `LearningEvidence`)

This is enough for personalization without building an ML platform.

### Update rules

```
New signal
  → write Observation and/or LearningEvidence (append-only)
  → decide whether to update current state

If updating current state:
  → if new provenance is EXPLICIT → update/replace attribute (high confidence)
  → if OBSERVED/INFERRED and conflicts with EXPLICIT high-confidence → do not overwrite; record observation only
  → if OBSERVED strengthens existing belief → bump confidence (capped)
  → if repeated OBSERVED contradicts old INFERRED → supersede inference, lower/replace
  → never delete evidence; supersede current-state rows
```

### Confidence policy (initial heuristics — not calibrated probability)

**Definition:** `confidence` is an **internal reliability / prioritization score**, **not** a calibrated statistical probability.

Confidence:

- is **not** a diagnosis
- is **not** a psychological measurement
- does **not** independently determine truth
- **cannot** override the provenance hierarchy

It must **not** be interpreted as “there is an X% chance this fact is true.”

**Provenance outranks the number:** Explicit `EXPLICIT` information remains authoritative over weaker `OBSERVED` / `INFERRED` / `HYPOTHESIS` information unless the student **explicitly** changes it. A higher numerical confidence alone must **never** cause an inferred belief to overwrite an explicit fact.

Initial heuristics (may be tuned later without changing semantics):

- Explicit answer: confidence `0.9`
- Explicit “not sure / skip”: no Attribute write (preferred), or write with confidence `0.3` and flag `uncertain`
- First observation: confidence `0.45`
- Repeated consistent observations: +0.05 each, cap `0.75` unless explicit confirmation
- Inferences: start ≤ `0.35`; require N supporting evidence items before influencing tutoring defaults
- AI-proposed inferences in Phase 2: **optional hook only**; default off — Phase 2 ships structure + onboarding writes, not autonomous profiling bots

### Precedence (must not silently overwrite explicit prefs)

High-confidence **EXPLICIT** student information must not be silently overwritten by weaker **OBSERVED** or **INFERRED** information.

Example:

- Student explicitly says: “I prefer short explanations.”
- Later observations suggest: “The student frequently asks for more detail.”

Correct behavior:

- preserve the explicit preference as current state
- append the observation (and optional LearningEvidence)
- allow a later **explicit** correction or confirmation to change the preference

Never silently replace student-stated goals or preferences with AI guesses. Repeated observations cannot silently rewrite explicit facts.

### Historical preservation

- Observations/Evidence: append-only
- Attributes/Goals/ConceptState: update in place **or** supersede (recommended: soft-supersede for attributes that change)
- Do not rewrite old evidence rows

### Timestamps

All model tables: `createdAt`; mutable current-state: `updatedAt`; evidence: event time = `createdAt` (+ optional `occurredAt` if delayed).

---

## 4. Onboarding specification

### Goals

- ≤ **30** questions (target **22–26** core)
- Establish a *useful initial* Student Model
- Feel like setup for academic help, not a psych survey
- Skippable where possible; never block account forever (soft gate)

### UX principles

- Short steps, one job per screen (or small grouped clusters)
- Progress indicator, clear “Skip for now”
- Plain language; no diagnostic jargon
- End with: “Flux will improve from how you study — this was just a starting point.”
- Do **not** present results as “you are an X learner”

### Gate behavior

- `StudentProfile.onboardingCompletedAt` set when finished or explicitly dismissed after minimum path
- Soft gate: after login, if null → prompt onboarding; allow “Later” (sets `onboardingSkippedAt` in implementation)
- AI works without full onboarding (degraded context)

### Question categories (mapped)

| # | Category | Count | Maps to | Required? |
|---|----------|-------|---------|-----------|
| A | Academic identity | 3–4 | Profile.academicLevel; Attributes `academic.*` | Mostly yes |
| B | Current courses (lightweight) | 2–4 | Attributes `course.self_reported.*` / free text list | Optional detail |
| C | Goals | 3–4 | `StudentGoal` | At least 1 |
| D | Interests | 2–3 | Attributes `interest.*` | Optional |
| E | Challenges / weak areas | 2–3 | Attributes `challenge.*` + optional Concept tags later | Optional |
| F | Assistance preferences | 3–4 | Profile + Attributes `pref.*` | Recommended |
| G | Study habits (behavioral self-report) | 2–3 | Attributes `habit.*` (EXPLICIT, revisable) | Optional |
| H | Motivation / context | 1–2 | Attributes `context.*` | Optional |
| I | What Flux should help with | 2–3 | Attributes `intent.*` + Goals | Recommended |

**Total target:** ~24 questions (≤30), with ~9 marked essential for “complete,” rest optional/skippable. Privacy/legal consent are **not** onboarding questions (see §4.1).

### Essential questions (must ask; allow skip with cost of weaker personalization)

1. Academic level (HS / undergrad / grad / other)
2. Primary subjects this term (multi-select + other)
3. Top goal for using Flux (pass class / deepen understanding / exam prep / organization / other)
4. Biggest current academic challenge
5. Preferred assistance: more hints vs more explanation vs check-my-work first
6. Explanation preference: concise vs detailed
7. Whether they want Flux to push participation (guided) by default
8. What “success this month” looks like (short text)
9. Typical weekly study time (bands)

### 4.1 Privacy notice ≠ legal consent — remove consent from onboarding questions

**Do not** include a “Consent note”, consent quiz item, or legal-consent question in the onboarding question catalog.

Onboarding is **not** the legal consent mechanism.

Distinguish:

| Concern | Phase 2 treatment |
|---------|-------------------|
| Academic onboarding | Versioned personalization questions only |
| Privacy / data-use notice or acknowledgment | Separate product flow/copy — **not** an onboarding quiz question |
| Legal consent / authorization | Separate compliance flow after legal review; **not** established by completing onboarding |

Rules:

- Onboarding may use normal product language about personalization where appropriate; that is **not** legal consent
- Legal consent is **not** established merely by completing onboarding
- Actual consent/authorization requirements depend on age, jurisdiction, deployment context, and applicable law
- Legal review remains required before launch
- Do **not** build the legal consent system in Phase 2
- Do **not** claim onboarding satisfies COPPA/GDPR/FERPA/etc.

Flux may process educational personal data and may serve minors (**Code ≠ compliance**).

### Optional / learn later through interaction

- Exact course codes, instructor names → Phase 3 Classes
- Topic-level mastery → evidence over time
- Misconceptions → tutoring sessions
- True study behavior → observations (not self-report alone)
- Effective pedagogical tactics → outcome-linked observations

### Skip handling

- Skipped question → **no Attribute write** (preferred minimization)
- Represent skip explicitly on `OnboardingAnswer` (`skipped=true`; no or empty validated payload)
- Do not invent Attribute rows for skips
- Onboarding progress stored as `OnboardingAnswer` rows so the session can resume

### Onboarding question registry + answer validation (server-side)

Retain `OnboardingSession` + `OnboardingAnswer`.

The **server-side versioned onboarding catalog** is the only source of questions. Each question definition specifies:

| Field | Purpose |
|-------|---------|
| `questionId` | Stable ID within a version |
| `onboardingVersion` | Catalog version (bound to session) |
| expected answer type | enum, string, multi-select, boolean, etc. |
| validation schema | server Zod/schema |
| maximum length / size | enforced server-side |
| multiple values allowed? | yes/no |
| essential? | yes/no |
| can be skipped? | yes/no |
| mapping target | e.g. Attribute key / Goal / Profile field — **server-defined only** |

**Clients cannot define:** `questionId`, mapping target, attribute key, provenance, or confidence.

Session / answer states (explicit):

| State | Meaning |
|-------|---------|
| unanswered | No `OnboardingAnswer` row yet for that question |
| skipped | `OnboardingAnswer.skipped = true` (no Attribute write) |
| answered | Validated payload stored; mapped server-side if applicable |
| `IN_PROGRESS` | Session ongoing |
| `DISMISSED` | Soft-gated away (`onboardingSkippedAt` / dismissed) |
| `COMPLETED` | Finished path; `onboardingCompletedAt` set |

Rules:

- Answers validated against the session’s catalog version
- Unsupported fields rejected; oversized answers rejected
- Invalid `questionId` rejected
- `answerJson` is storage only — **never** arbitrary unvalidated JSON
- Mapping to `StudentAttribute` / `StudentGoal` / Profile is **server-controlled** via registries

### Contradiction handling

- Later EXPLICIT settings edit supersedes onboarding Attribute (atomic one-active-key rule)
- Later OBSERVED conflict: keep EXPLICIT; add Observation noting conflict; optionally surface in UI later (“You said X; your practice suggests Y”)
- Never silently replace student-stated goals with AI guesses

### Tone anti-patterns to avoid

- Long personality inventories
- “Which learning style are you?”
- Forced ranking of 20 values
- Medical/mental-health diagnosis framing

### Sample question → storage mapping (illustrative)

| Question | Storage |
|----------|---------|
| “What is your academic level?” | `StudentProfile.academicLevel` + Attribute `academic.level` EXPLICIT 0.9 |
| “Main subjects this term?” | Attributes `academic.subjects` JSON array EXPLICIT 0.9 |
| “Top goal?” | `StudentGoal` title/type EXPLICIT |
| “Prefer concise explanations?” | Attribute `pref.explanation_length=concise` + Profile.preferredAssistanceStyle convenience |
| “Struggle with math word problems?” | Attribute `challenge.math_word_problems=true` EXPLICIT 0.85 |

---

## 5. Knowledge Foundation architecture

### Intent

Support the learning loop:

Acquire → Understand → Organize → Connect → Retrieve → Apply → Evaluate → Refine

with a **small extensible catalog**, not a giant graph.

### Hierarchy (Phase 2)

```
Subject          (e.g., Mathematics, Biology)     — shared catalog
  └── Topic      (e.g., Algebra, Quadratic equations)
        └── Concept (e.g., Factoring trinomials)
```

### Relationships (minimal)

`ConceptRelation`:

- `PREREQUISITE` (A before B)
- `RELATED` (soft association)

No transitive closure engine, no embedding index, no ontology import pipeline in Phase 2.

### Concept identity

- Concepts are **global catalog entities**, not per-student copies
- Stable `slug` + `subjectId`
- Optional `aliases[]` / description for tutor grounding
- Seed a **small starter catalog** in implementation (dozens–low hundreds of concepts max), expandable later
- User-defined concepts: allow `source=USER` concepts owned by `createdByUserId` for custom topics (optional in Phase 2b)

### What Phase 2 does *not* build

- Full curriculum graphs for all subjects
- Automatic syllabus → graph ingestion
- Vector knowledge base
- Cross-institution standards alignment (Common Core DB, etc.)

---

## 6. Student ↔ Knowledge relationship

```
Student (User)
  └── StudentConceptState     (current mastery for Concept)
  └── LearningEvidence        (events supporting/refuting mastery)
  └── StudentMisconception    (active/resolved, optional Concept link)
  └── (Phase 3) Class/Enrollment/Task links to Concept via join tables later
```

### Where mastery lives

**`StudentConceptState`** (current state per student×concept):

- `mastery` enum or 0–1 score: `UNKNOWN | INTRODUCED | DEVELOPING | PROFICIENT | MASTERED` (recommended enum for clarity)
- `confidence` 0–1 (how sure Flux is of that mastery label)
- `lastEvidenceAt`
- provenance of last update

### Where evidence lives

**`LearningEvidence`** (append-only):

- links: `userId`, optional `conceptId`, optional `observationId`
- `kind`: `SELF_REPORT | PRACTICE_SUCCESS | PRACTICE_FAILURE | TUTOR_SIGNAL | QUIZ_ITEM | REVIEW`
- `polarity`: supports higher mastery / supports lower / neutral
- `weight` small numeric
- `source` + optional auxiliary non-relational metadata only (no full chat transcripts; **no DB ID arrays**)

### Misconceptions

**`StudentMisconception`**:

- `userId`, optional `conceptId`
- `statement` (short normalized text)
- `status`: `ACTIVE | RESOLVED | DISMISSED`
- `confidence`, `provenance`
- **Fields do not include** `evidenceIds`, evidence-ID arrays, or metadata links to evidence rows

**No database relationships inside JSON metadata.**

- Phase 2 does **not** require a misconception→evidence relationship
- Database IDs must **not** be stored in arbitrary metadata JSON as the primary relationship mechanism
- If the relationship is needed later, create a proper relational join table such as `MisconceptionEvidence` (`misconceptionId`, `evidenceId`)
- Keep `StudentMisconception` and `LearningEvidence` as separate entities in Phase 2
- Metadata (where present on evidence/observation rows) is only for genuinely auxiliary **non-relational** data — never ID arrays or foreign-key substitutes

### Mastery update contract (Phase 2)

**Forbidden Phase 2 path:**

```
student response → model judgment → MASTERED
```

Roles:

| Entity | Role in Phase 2 |
|--------|-----------------|
| `StudentConceptState` | Current mastery label Flux believes *now* for a concept |
| `LearningEvidence` | Append-only events that may later support/refute mastery |
| `StudentObservation` | Append-only measured behavior / academic observations |

**Allowed Phase 2 mutations of `StudentConceptState`:**

| Operation | Allowed? | Provenance |
|-----------|----------|------------|
| Onboarding / settings self-report of weak/intro topics (server-mapped) | **Yes** | EXPLICIT |
| Student explicit correction via settings/API | **Yes** | EXPLICIT |
| Recording `LearningEvidence` alone | Creates evidence only — **does not** auto-mutate mastery |
| Recording `StudentObservation` alone | Observation only — **does not** auto-mutate mastery |
| Automatic inference from one practice success/failure | **No** |
| `TUTOR_SIGNAL` / model judgment → authoritative ConceptState | **No** (not EXPLICIT; cannot silently become fact) |
| Sophisticated automatic mastery algorithm | **Deferred** (Phase 4/6) |

Rules:

- Evidence can be recorded; evidence does **not** automatically equal mastery
- One practice success does **not** establish `MASTERED`
- One practice failure does **not** establish “weak”
- Model-generated `TUTOR_SIGNAL` is **not** equivalent to `EXPLICIT`
- AI-generated observations/inferences cannot silently become authoritative student facts
- Keep the mastery algorithm intentionally simple/deferred — Phase 2 establishes the data model and write boundaries, not the algorithm

### Concepts across courses

- Same `Concept` row reusable
- Phase 3 adds `ClassConcept` or `TaskConcept` joins without cloning concepts
- StudentConceptState remains student-scoped, course-agnostic (course filters via joins later)

---

## 7. AI context architecture

### Problem

Flux must answer: *What does Flux need to know about this student for this interaction?*  
Not: *Dump the whole student database into the prompt.*

### New interface (design)

```ts
// Future: src/lib/ai/context-assembly.ts
assembleAIContext(input: {
  userId: string
  taskType: AITaskType
  // optional focus from UI / Phase 3
  classId?: string
  taskId?: string
  conceptIds?: string[]
  userMessage: string
}): Promise<AssembledLearningContext>
```

`AssembledLearningContext` (conceptual):

- `profile`: displayName, academicLevel, prefs (small)
- `goals`: top 1–3 active
- `attributes`: high-confidence prefs/challenges only (budgeted)
- `concepts`: relevant ConceptState + active misconceptions for focus concepts
- `recentObservations`: last N short summaries (not raw chat)
- `policyHints`: e.g. prefer hints; avoid answer dump
- `provenanceNotes`: what was EXPLICIT vs OBSERVED (for system prompt caution)

### Selection heuristics (Phase 2 — no premature keyword intelligence)

Phase 2 priority order:

1. Explicitly supplied and **server-validated** focus (`conceptIds`, later class/task IDs)
2. Class/task context when available in later phases
3. Reliable concept matches **only when** such a resolver exists (not required in Phase 2)
4. Active misconceptions for **confirmed** relevant concepts
5. High-confidence relevant preferences (registry + context-eligible)
6. Active goals
7. Recent relevant evidence/observations
8. Stop at budget

**If no reliable concept resolver exists in Phase 2, Flux must not substitute a low-quality keyword matcher merely to satisfy the architecture.**

Do **not** add embeddings, vector search, RAG, or another AI call for concept resolution in Phase 2.

Focus sources preferred: explicit `conceptIds`, explicit user-selected focus, later class/task context.

### Student context is untrusted data (prompt-injection boundary)

All student-originated (and AI-derived student-model) content is **DATA**, not instructions. This includes:

- onboarding text / answers
- goals, interests, attribute values
- observations, evidence summaries
- misconception statements
- imported student information
- future user-generated content

`assembleAIContext` must:

- select only **approved** fields (registry / allowlist)
- enforce field-length limits (Appendix B)
- use **structured serialization** (labeled fields; not raw free-form dump)
- preserve provenance
- distinguish explicit facts from observations/inferences
- never allow student data to override system/application policy
- never trust client-supplied provenance or confidence
- never treat stored text as system instructions
- never inject raw chat transcripts automatically

Conceptual priority (highest → lowest):

```
SYSTEM / SAFETY / APPLICATION POLICY
        ↓
APPLICATION-CONTROLLED AI POLICY
        ↓
TRUSTED APPLICATION STATE (authz, entitlements, routing)
        ↓
STUDENT DATA AS UNTRUSTED CONTEXT
        ↓
CURRENT USER REQUEST
```

Do not over-engineer a full prompt-injection research stack in Phase 2; establish this architectural boundary.

### Integration with Phase 1 orchestration

Replace ad-hoc profile string building in `runAIOrchestration` with `assembleAIContext`.

After response (Phase 2 optional hook / Phase 4 real):

- `recordObservation(...)` / `recordLearningEvidence(...)` — **feature-flagged**, never trust model output as EXPLICIT fact; `TUTOR_SIGNAL` does not bypass update rules

### Cost control

- Context assembly must be cheap (DB queries, no extra LLM call in Phase 2)
- Hard caps: e.g. max 3 goals, 5 attributes, 5 concept states, 3 misconceptions per request

---

## 8. Proposed Prisma models (smallest sensible set)

> Proposed only — **no migrations in this task.**

### Keep / extend

#### `StudentProfile` (extend lightly)

**Purpose:** Stable 1:1 profile + onboarding gate  
**Key fields (existing + proposed):**  
`userId`, `displayName`, `academicLevel`, `timezone`, `preferredAssistanceStyle`, `goalsSummary`, `onboardingCompletedAt`, **`onboardingVersion`**, **`onboardingSkippedAt`**  
**Ownership:** `userId` unique  
**Security:** owner-only; never return to other users  
**State vs history:** current state

### New models

#### `StudentAttribute`

**Purpose:** Typed, registry-controlled key/value facts — **not** an arbitrary profile store  
**Fields:** `id`, `userId`, `key` (registry-allowlisted only), `valueJson` (schema-validated per key), `provenance`, `confidence`, `source`, `supersededAt?`, `supersededById?`, `createdAt`, `updatedAt`  

**Active uniqueness invariant (design requirement — not implemented yet):**  
At most one **active** `StudentAttribute` exists for each `(userId, key)` — i.e. at most one row per `(userId, key)` with `supersededAt IS NULL`.

Preferred PostgreSQL implementation (create during Phase 2 implementation, **not now**):

```
UNIQUE(userId, key)
WHERE supersededAt IS NULL
```

as a **partial unique index**. Example:

```sql
CREATE UNIQUE INDEX student_attribute_one_active_per_key
  ON "StudentAttribute" ("userId", "key")
  WHERE "supersededAt" IS NULL;
```

**Prisma note:** Ordinary Prisma `@@unique([userId, key])` does **not** express the `WHERE supersededAt IS NULL` predicate. Do **not** pretend it can. Implementation must add the partial unique index via a **SQL migration** during Phase 2 implementation (design-only here).

**Application writes:** supersede the previous current attribute and create the replacement **atomically / transactionally**. Concurrent writes must not create multiple active values for the same `(userId, key)`.

**Supporting indexes (non-uniqueness history/lookup):** `(userId, key)`, `(userId, supersededAt)`  

**Ownership:** user  
**Security:** owner-only; `key` server-controlled; clients cannot invent keys or set provenance/confidence/source; no direct arbitrary writes  
**State:** at most one active row per `(userId, key)`; history via superseded rows  
**Writes:** server mapping only (onboarding / settings / system)

#### `StudentGoal`

**Purpose:** Structured goals  
**Fields:** `id`, `userId`, `title`, `description?`, `category?`, `status` (`ACTIVE|ACHIEVED|ABANDONED`), `priority?`, `provenance`, `confidence`, `source`, `targetDate?`, `createdAt`, `updatedAt`  
**Indexes:** `(userId, status)`  
**Ownership:** user  
**State:** current

#### `OnboardingSession` + `OnboardingAnswer`

**Purpose:** Resumeable onboarding without survey lock-in  
**Session fields:** `id`, `userId`, `version` (question-catalog version), `status` (`IN_PROGRESS|COMPLETED|DISMISSED`), `startedAt`, `completedAt?`  
**Answer fields:** `id`, `sessionId`, `questionId` (catalog ID for that version), `answerJson` (validated payload only), `skipped` bool, `createdAt`  
**Indexes:** `(userId, status)`, `(sessionId, questionId)` unique  
**Ownership:** user  
**State:** session current; answers historical log of onboarding itself  
**Validation:** server-side catalog + schema; client cannot set provenance/confidence/keys

#### `Subject` / `Topic` / `Concept`

**Purpose:** Shared knowledge catalog  
**Subject:** `id`, `slug` unique, `name`, `description?`  
**Topic:** `id`, `subjectId`, `slug`, `name`, `description?`; unique `(subjectId, slug)`  
**Concept:** `id`, `topicId`, `slug`, `name`, `description?`, `source` (`SYSTEM|USER`), `createdByUserId?`; unique `(topicId, slug)`  
**Ownership:** catalog global; user-created concepts constrained to owner for edits  
**Security:** read broadly for SYSTEM; USER concepts readable only by owner unless published later  
**State:** catalog current

#### `ConceptRelation`

**Purpose:** Minimal graph edges  
**Fields:** `id`, `fromConceptId`, `toConceptId`, `type` (`PREREQUISITE|RELATED`)  
**Indexes:** `(fromConceptId)`, `(toConceptId)`, unique `(fromConceptId, toConceptId, type)`  
**State:** catalog

#### `StudentConceptState`

**Purpose:** Current mastery per student×concept  
**Fields:** `id`, `userId`, `conceptId`, `mastery`, `confidence`, `provenance`, `source`, `lastEvidenceAt?`, `createdAt`, `updatedAt`  
**Indexes:** unique `(userId, conceptId)`, `(userId, mastery)`  
**Ownership:** user  
**Security:** owner-only  
**State:** current

#### `LearningEvidence`

**Purpose:** Append-only evidence for mastery/personalization  
**Fields:** `id`, `userId`, `conceptId?`, `observationId?`, `kind`, `polarity`, `weight`, `source`, `summary` (short, non-transcript), `metadata?` (auxiliary non-relational only — **no DB ID arrays**), `createdAt`  
**Indexes:** `(userId, createdAt)`, `(userId, conceptId, createdAt)`  
**Ownership:** user  
**Security:** owner-only; no full chat content  
**State:** historical evidence (append-only; does not auto-set mastery)

#### `StudentObservation`

**Purpose:** Append-only behavioral/academic observations  
**Fields:** `id`, `userId`, `category` (e.g. `study`, `assistance`, `engagement`), `type`, `summary`, `provenance` (usually OBSERVED), `confidence`, `source`, `metadata?` (auxiliary non-relational only — **no DB ID arrays**), `createdAt`  
**Indexes:** `(userId, createdAt)`, `(userId, category, createdAt)`  
**Ownership:** user  
**State:** historical

#### `StudentMisconception`

**Purpose:** Track active misconceptions  
**Fields:** `id`, `userId`, `conceptId?`, `statement`, `status`, `provenance`, `confidence`, `source`, `resolvedAt?`, `createdAt`, `updatedAt`  
**Indexes:** `(userId, status)`, `(userId, conceptId)`  
**Ownership:** user  
**State:** current (+ resolved history via status)  
**Note:** Phase 2 has **no** misconception→evidence relationship and **no** evidence IDs in metadata; future join table if needed (`MisconceptionEvidence`) only

### Explicitly deferred models (Phase 3+)

- `Class`, `Enrollment`, `Assignment`, `Task`, `CalendarEvent`
- `ClassConcept`, resource/document graphs
- `MisconceptionEvidence` (join) — only if needed later
- Recommendation engine tables
- Teacher/org hierarchies

### Relationship diagram (conceptual)

```
User 1─1 StudentProfile
User 1─* StudentAttribute / StudentGoal / OnboardingSession
User 1─* StudentObservation / LearningEvidence
User 1─* StudentConceptState / StudentMisconception
Subject 1─* Topic 1─* Concept
Concept *─* Concept (via ConceptRelation)
Concept 1─* StudentConceptState
```

---

## 9. Data flow

### Onboarding write path

```
UI answers
 → server action (authz)
 → validate questionId/answer against onboarding catalog (code config)
 → upsert OnboardingAnswer
 → map to StudentAttribute / StudentGoal / StudentProfile fields (EXPLICIT)
 → optional StudentConceptState self-report
 → AuditLog onboarding.completed | dismissed
```

### AI request path (Phase 2 target)

```
User message
 → authz + entitlement reserve (Phase 1)
 → route + policy (Phase 1)
 → assembleAIContext (NEW)  // budgeted retrieval
 → provider
 → usage log (Phase 1)
 → optional observation/evidence hooks (feature-flagged)
```

### Settings correction path

```
Student edits preference/goal
 → server validates against attribute/goal registries
 → EXPLICIT write (server sets provenance/confidence/source)
 → atomic supersede prior Attribute (one active per user+key) / Goal
 → AuditLog profile.updated
```

Clients never submit provenance, confidence, source, or arbitrary attribute keys.

### Deletion path (technical semantics — not legal retention claims)

Phase 2 introduces significant educational personal data. Intended **technical** deletion semantics:

| Record | On account / data delete |
|--------|--------------------------|
| `StudentProfile` | **Delete** (user-owned) |
| `StudentAttribute` | **Delete** (user-owned, including superseded history) |
| `StudentGoal` | **Delete** |
| `OnboardingSession` | **Delete** |
| `OnboardingAnswer` | **Delete** |
| `StudentObservation` | **Delete** |
| `LearningEvidence` | **Delete** |
| `StudentConceptState` | **Delete** |
| `StudentMisconception` | **Delete** |
| Future student-owned relations | **Delete** / cascade with ownership |
| Global `Subject` / `Topic` / SYSTEM `Concept` / SYSTEM `ConceptRelation` | **Retain** (shared catalog; not user-owned) |
| USER-created `Concept` owned by user | **Delete** or reassign per policy (prefer delete if unused) |
| `AuditLog` | **Operational** — retention/anonymization subject to product/legal policy (not claimed here) |
| `UsageRecord` | **Operational** — retention/anonymization subject to product/legal policy |
| `AIInteraction` | **Operational** — retention/anonymization subject to product/legal policy |

Final retention periods and legal exceptions require privacy/legal review. Do **not** claim these rows satisfy a specific statute.

Technical requirements:

- Deletion must respect ownership and authorization
- Phase 2 implementation **must** establish and **test** ownership/deletion semantics for user-owned educational data (§9 table; §12 DELETION)
- Privacy **export** may remain appropriately scoped; **deletion/ownership behavior must not be a TODO**

```
Account delete / data delete request
 → authorize owner (or admin policy later)
 → delete user-owned student/knowledge-state rows (table above)
 → handle AuditLog / UsageRecord / AIInteraction per retention policy (anonymize or delete)
 → catalog SYSTEM Subject/Topic/Concept rows remain
```

---

## 10. Privacy / security considerations

### Phase 2 increases sensitivity

Onboarding and student attributes are **educational personal data**, possibly about minors later.

### Controls (design)

| Control | Approach |
|---------|----------|
| Minimization | Skip = no Attribute row; avoid psychometrics; short summaries only |
| Isolation | All student tables keyed by `userId`; server-side ownership checks (IDOR tests) |
| Access | Owner only in Phase 2 (no teacher role yet) |
| Attribute registry | Allowlisted keys; server sets provenance/confidence/source |
| Inferences | Low confidence; cannot override EXPLICIT; optional/off by default |
| Deletion | Clear user-owned delete semantics (§9); operational rows separate; legal review for retention |
| Correction | Settings + atomic supersede (one active attribute per key) |
| Retention | Periods TBD via legal review; default keep while account active |
| Audit | Onboarding complete, dismiss, profile corrections |
| Telemetry split | Keep `UsageRecord` free of educational content |
| Untrusted context | Student/AI-derived fields are DATA in prompts; policy outranks context |
| Privacy notice vs consent | Privacy/data-use notice is a separate product flow; not an onboarding question; ≠ legal consent (§4.1) |

### Legal / privacy review required before launch (not claimed done)

- COPPA (if under-13 / mixed ages)
- FERPA (if school deployments)
- GDPR/UK GDPR lawful basis, retention, DPIA if EU users
- State student privacy laws
- Parental consent flows (**separate** from onboarding personalization)
- School contract data processing terms

**Code ≠ compliance.**

### Security notes

- Onboarding answers validated server-side (allowlisted question IDs + schemas for session version)
- No client-authored provenance upgrades (`INFERRED` cannot be posted by client as `EXPLICIT`)
- No client-invented attribute keys
- Context assembly must not accept client-provided “student facts” as trusted truth without server verification
- Free-form student text and stored context are untrusted; cannot override system/policy/entitlements

---

## 11. Implementation sequence (for later — not this task)

Safe order after design approval:

| Layer | Work | Completion criterion |
|-------|------|----------------------|
| **2.0** | Schema + migrations (incl. partial unique active attribute; SQL migration if needed) | Migrate deploy; Prisma generate; no UI yet |
| **2.1** | Attribute registry + repositories/services (goals, provenance, supersede) | Registry + one-active-key + precedence unit tests |
| **2.2** | Onboarding catalog + validation + server actions / mapping | Invalid questionId/shape rejected; server-controlled mapping |
| **2.3** | Onboarding UI (multi-step, skip, resume, dismiss) | Soft gate; unanswered/skipped/dismissed/completed states |
| **2.4** | Knowledge seed (Subject/Topic/Concept + few relations) | Seed script idempotent |
| **2.5** | StudentConceptState + misconception services (self-report only) | Owner-scoped; mastery contract enforced |
| **2.6** | `assembleAIContext` + orchestration integration | Budgeted, allowlisted, untrusted-data handling |
| **2.7** | Observation/evidence helpers | Append-only; no silent EXPLICIT overwrite; TUTOR_SIGNAL rules |
| **2.8** | Ownership/deletion semantics + tests for user-owned educational data (export optional/scoped) | User-owned rows deleted/cascaded per §9; catalog retained; operational retention policy documented; deletion tests required |
| **2.9** | Integration / security / regression tests + CI | Attribute, onboarding, provenance, mastery, context, deletion, Phase 1 green |

Each layer merges only when its criterion is met. **Do not implement any of these in this documentation task.**

---

## 12. Testing strategy (Phase 2 implementation)

### ATTRIBUTE SECURITY

- invalid attribute key rejected
- invalid attribute value rejected
- client cannot set provenance
- client cannot set confidence authority
- client cannot set source authority
- only one active attribute per user/key (including concurrent supersede)
- superseding is atomic
- cross-user access rejected (IDOR)

### ONBOARDING

- invalid questionId rejected
- invalid answer shape rejected
- oversized answer rejected
- mapping is server-controlled
- skip works
- resume works
- dismiss works
- completion works

### PROVENANCE

- explicit beats inference
- inference cannot overwrite explicit
- repeated observations cannot silently rewrite explicit facts
- client cannot upgrade provenance
- confidence score alone cannot override provenance hierarchy

### MASTERY

- self-report follows defined mutation rules
- evidence is append-only
- practice success does not automatically mean MASTERED
- TUTOR_SIGNAL is not EXPLICIT
- evidence/observation alone does not auto-mutate ConceptState to MASTERED

### CONTEXT

- hard context limits
- only approved fields selected
- student text treated as untrusted data
- stored student content cannot override application policy
- raw chat is not automatically injected
- client-provided student facts are not trusted
- no keyword-matcher required for Phase 2 correctness

### DELETION

- user-owned records are isolated
- deletion removes appropriate user-owned data
- global catalog records survive (Subject/Topic/SYSTEM Concept/ConceptRelation)
- operational/audit handling follows documented policy

### REGRESSION

- Phase 1 tests remain green
- typecheck
- lint
- build
- CI
- `reserveCapability` / entitlement path intact

### Need not test yet

- ML accuracy / calibrated confidence
- Full curriculum coverage
- LMS import fidelity
- Semantic retrieval / embeddings quality

---

## 13. Risks / tradeoffs

| Risk | Mitigation |
|------|------------|
| Over-building knowledge graph | Cap Phase 2 to Subject/Topic/Concept + 2 relation types; small seed |
| Profile / Attribute becoming a blob | Server-side attribute registry; no arbitrary keys/JSON |
| Onboarding friction | ≤30 Q; skip; soft gate |
| Premature inference / mastery engine | Structure + evidence only; conservative mastery boundary |
| Premature keyword “intelligence” | No keyword matcher required in Phase 2; explicit/server-validated focus only |
| Prompt injection via stored context | Untrusted-data boundary; allowlists; policy precedence |
| Prompt cost growth | Hard context budgets |
| Privacy / consent conflation | Notice ≠ legal consent; separate compliance flows |
| Ambiguous deletion | Explicit per-table technical semantics + tests |
| Phase 3 class model mismatch | Keep concepts global; join later |

**Tradeoff accepted:** Self-reported courses in onboarding as attributes, not full Class entities — Class CRUD is Phase 3.

---

## 14. Explicit Phase 2 non-goals

Do **not** build in Phase 2:

- Giant multi-domain knowledge graph / ontology / full curriculum graph import
- Sophisticated ML learner model / bandits / reinforcement learning
- Automatic psychological profiling or psychometric testing
- Medical / mental-health inference
- Complex recommendation engine / “Flux recommends” product surface (Phase 6/7)
- Analytics vanity dashboards
- LMS / SIS / Google Classroom connectors
- Teacher, parent, or school admin systems / parent dashboard
- Real LLM provider swap (still stub OK; context wiring only)
- Document upload / RAG / full resource ingestion
- Full Classes / Tasks / Calendar CRUD
- Billing / trial economics changes
- Learning-style quizzes
- Advanced mastery prediction / automatic silent identity rewriting from AI chat
- Sophisticated semantic concept retrieval as a Phase 2 dependency

Phase 2 remains a foundational **student-model + onboarding + knowledge/context architecture** phase.

---

## 15. Definition of Done (Phase 2)

**Claiming documentation completeness ≠ claiming architecture approval.** Approval is a human decision after final review.

Phase 2 (design + future implementation) Definition of Done explicitly requires:

1. **Controlled StudentAttribute registry** (allowlisted keys; server-set provenance/confidence/source; typed values)
2. **One-active-attribute invariant** (`UNIQUE(userId, key) WHERE supersededAt IS NULL` + atomic supersede)
3. **Server-validated onboarding registry** (questionId, version, schemas, mapping targets; no client-defined keys)
4. **Provenance enforcement** (EXPLICIT authoritative; client cannot upgrade provenance)
5. **Confidence semantics** (reliability/prioritization score — not probability, diagnosis, or truth override)
6. **Conservative mastery contract** (no `response → model → MASTERED`; evidence ≠ automatic mastery)
7. **No relational IDs in metadata JSON** (join tables later if needed; e.g. `MisconceptionEvidence`)
8. **Privacy notice separated from legal consent** (no consent question in onboarding; legal flows separate)
9. **Student context treated as untrusted data** (priority stack; structured serialization; policy outranks context)
10. **Bounded context assembly** (allowlists, budgets; no premature keyword intelligence required)
11. **Defined ownership/deletion semantics** (user-owned vs catalog vs operational)
12. **Required authorization / provenance / context / deletion / mastery tests** (§12)
13. **Phase 1 regression protection** (tests, typecheck, lint, build, CI; entitlements intact)
14. **Documentation consistency** across PHASE2 / STUDENT_MODEL / IMPLEMENTATION_PLAN / ARCHITECTURE / AI_SYSTEM
15. **All Phase 2 non-goals preserved** (§14)

### Implementation Done (future — after approval only)

- Schema migrated (including partial unique index via SQL if needed)
- Onboarding complete/dismiss/skip/resume within ≤30 questions
- Server-mapped EXPLICIT attributes/goals
- Minimal knowledge catalog + optional self-report ConceptState
- `assembleAIContext` wired with budgets + untrusted-data handling
- Evidence/observation helpers without silent identity rewrite
- Deletion/ownership tests green; catalog retained
- §12 tests green; Phase 1 CI green

---

## Appendix A — Onboarding question catalog sketch (for implementation config)

Store as versioned code config `ONBOARDING_VERSION = "2026-09-phase2"`.

**Cluster 1 — You (3):** academic level; graduation/target year band; primary learning setting (HS/college/self)  
**Cluster 2 — What you’re taking (4):** subjects multi-select; hardest class now (text); optional course list; optional exam soon?  
**Cluster 3 — Goals (4):** primary goal; secondary goal; success this month; organization vs understanding priority  
**Cluster 4 — Preferences (4):** explanation length; hint-first vs explain-first; check-my-work preference; default guided participation  
**Cluster 5 — Challenges (3):** top challenge; topics that feel shaky (multi); time pressure?  
**Cluster 6 — Habits (3):** study days/week band; typical session length; preferred study time of day  
**Cluster 7 — Help intent (3):** what Flux should prioritize; notifications comfort (later); anything Flux should avoid  

≈ **24–25** items; mark ~9 essential in config. **No consent/legal question** in the catalog.

---

## Appendix B — Context assembly budget (initial proposal)

| Slice | Max items | Max chars (approx) |
|-------|-----------|--------------------|
| Profile | 1 | 200 |
| Goals | 3 | 300 |
| Prefs/challenges attributes | 5 | 400 |
| Concept states | 5 | 400 |
| Misconceptions | 3 | 300 |
| Recent observations | 3 | 300 |

Total assembled context target: **well under** one cheap-model context chunk; adjust in Phase 4 with token accounting.

---

## Appendix C — Documents updated by this design task

- `docs/PHASE2_ARCHITECTURE.md` (this file — final architecture-review correction pass)
- `docs/STUDENT_MODEL.md` (aligned to design)
- `docs/IMPLEMENTATION_PLAN.md` (Phase 1 complete; Phase 2 design)
- `docs/AI_SYSTEM.md` (untrusted student context; Phase 2 assembly pointer)
- `docs/ARCHITECTURE.md` (Phase 2 pointer only where needed)

**No application code, schema, or migrations changed.**

## Appendix D — Remaining items for human decision (not blockers to review)

These are intentional open points for final architecture review — not invitations to expand Phase 2 scope:

1. Exact final attribute-key catalog naming (`pref.*` vs `preference.*`, `habit.*` vs `study.*`) — one namespace preferred at implementation.
2. Whether `supersededById` is mandatory on Attribute rows or optional when partial unique + timestamps suffice.
3. Exact anonymization vs deletion strategy for `AuditLog` / `UsageRecord` / `AIInteraction` after legal review.
4. When (after Phase 2) a reliable concept resolver may be introduced — **not** via low-quality keyword matching in Phase 2.
