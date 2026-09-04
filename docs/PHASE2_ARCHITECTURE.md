# Phase 2 Architecture Design

**Status:** DESIGN ONLY — not implemented  
**Baseline:** `origin/main` @ `e1dc1d016eb3ee9329250933a7f995b185141c15` (Phase 1 tip `d98b388`)  
**Branch:** `cursor/phase2-architecture-design-399a`  
**Date:** 2026-09-04  
**Revision:** Architecture-review tightening (documentation only; core model unchanged)

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

**Extend relational structure.** Prefer small typed tables + optional JSON metadata over one giant student JSON blob. Prefer append-only evidence with revisable current state.

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

`StudentAttribute` must **not** become an unrestricted profile blob.

Flux maintains a **server-side attribute registry** (code config, versioned with onboarding/product config). Only registered keys may be written or read for personalization.

Illustrative registered keys (names may match existing `academic.*` / `pref.*` / `habit.*` conventions; exact catalog finalized at implementation):

| Example key | Role |
|-------------|------|
| `academic.level` | Academic level |
| `academic.subjects` | Subjects this term (structured multi-value) |
| `interest.primary` / `interest.secondary` | Interests |
| `pref.explanation_length` / `preference.explanation_length` | Explanation length preference |
| `pref.guided_participation` / `preference.guided_participation` | Guided participation preference |
| `pref.assistance_style` / `preference.assistance_style` | Assistance style |
| `habit.typical_weekly_time` / `study.typical_weekly_time` | Study time band |
| `challenge.primary` | Primary challenge |
| `approach.*` | Effective approaches (low initial confidence; never “learning style”) |

For **each** registered key, the server controls:

- allowed value type and validation schema
- maximum size / length
- scalar vs multi-value
- which flows may write it (onboarding / settings / system observation / AI inference)
- whether it may be included in AI context

**Critical security rule:** The client must **never** be trusted to choose:

- arbitrary attribute keys
- `provenance`
- `confidence`
- `source` classification

The server determines those values from the authenticated flow and registry rules.

**Prohibited:**

- Arbitrary client-created `StudentAttribute` keys
- Accepting arbitrary free-form JSON merely because the DB column is `Json`
- Controlled structured JSON is allowed **only** when the registered attribute’s schema requires it

### One active attribute per user + key (invariant)

For a given `(userId, key)`, there may be only **one active/current** attribute value:

```
UNIQUE (userId, key) WHERE supersededAt IS NULL
```

Preferred enforcement:

1. PostgreSQL **partial unique index** on `(userId, key) WHERE supersededAt IS NULL`
2. Transactional service-layer supersede (preferably **both**)

Explicit correction (atomic):

```
BEGIN
  mark current row: supersededAt = now(), supersededById = <newId> (or set after insert)
  insert new current row (supersededAt NULL) with EXPLICIT provenance
COMMIT
```

Do **not** allow concurrent writes to create multiple current values. `supersededById` (when used) points from the old row to the new current row; semantics must remain clear under concurrency (transaction + partial unique index).

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

**Semantics:** `confidence` is an **internal reliability / prioritization score** used to order and gate personalization. It is **not** a calibrated statistical probability and must **not** be interpreted as “there is an X% chance this fact is true.”

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

Never silently replace student-stated goals or preferences with AI guesses.

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

**Total target:** ~24 questions, with ~10 marked essential for “complete,” rest optional/skippable.

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
10. Product privacy / data-use **notice** (informational; see §4.1 — not legal consent)

### 4.1 Privacy notice ≠ legal consent

Onboarding must **not** become the legal-consent mechanism.

Distinguish three concerns:

| Concern | Role in product | Phase 2 treatment |
|---------|-----------------|-------------------|
| Product privacy / data-use notice | Explains how Flux uses onboarding answers and study activity for personalization | Short informational copy during onboarding is OK |
| Onboarding personalization | Helps Flux understand the student | Question catalog + Attribute/Goal writes |
| Legally required consent / authorization | Age gates, parental consent, school DPA, etc. | **Separate compliance flow after legal review** — not an onboarding question |

Do **not** design an onboarding answer as though it establishes legally sufficient consent. Do **not** claim onboarding satisfies COPPA/GDPR/FERPA/etc.

Flux may process educational personal data and may serve minors; appropriate legal/privacy review is required before launch (**Code ≠ compliance**).

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

### Onboarding answer validation (server-side)

Retain `OnboardingSession` + `OnboardingAnswer`, with these rules:

- Question IDs come **only** from a **server-side versioned question catalog**
- Session stores `version` (e.g. `ONBOARDING_VERSION = "2026-09-phase2"`); answers validated against that version’s catalog
- Answer schemas / types are defined by the question definition
- Maximum lengths / sizes enforced server-side
- Unsupported fields rejected
- Client **cannot** assign provenance, confidence, or source
- Client **cannot** write arbitrary `StudentAttribute` keys; mapping is server-side via registry
- `answerJson` is a storage representation only — it does **not** mean arbitrary unvalidated JSON is accepted

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
- `source` + metadata (no full chat transcripts by default)

### Misconceptions

**`StudentMisconception`**:

- `userId`, optional `conceptId`
- `statement` (short normalized text)
- `status`: `ACTIVE | RESOLVED | DISMISSED`
- `confidence`, `provenance`
- **No** arrays of evidence IDs in metadata JSON

Phase 2 keeps `StudentMisconception` and `LearningEvidence` as **separate entities** without a misconception↔evidence relationship. If a many-to-many link is needed later, use a dedicated relational join table (e.g. `MisconceptionEvidence` with `misconceptionId` + `evidenceId`) — **never** put database ID arrays inside generic metadata JSON.

### Conservative mastery updates (Phase 2 boundary)

Clarify roles:

| Entity | Role in Phase 2 |
|--------|-----------------|
| `StudentConceptState` | Current mastery label Flux believes *now* for a concept |
| `LearningEvidence` | Append-only events that may later support/refute mastery |
| `StudentObservation` | Append-only measured behavior / academic observations |

**Phase 2 must not** create an uncontrolled system where one AI interaction immediately becomes permanent mastery.

Explicit Phase 2 rules:

- Student **self-report** may update `StudentConceptState` (EXPLICIT)
- Learning interactions may create `LearningEvidence`
- Observations may record measured behavior
- **Automatic mastery inference remains conservative / deferred**
- A single correct answer must **not** automatically mean `MASTERED`
- A single incorrect answer must **not** automatically mean the concept is weak
- `TUTOR_SIGNAL` must **not** automatically become educational truth merely because the model produced it
- If model-derived evidence is recorded, it retains appropriate provenance/source and **must not** bypass student-model update / precedence rules

**Phase 2 focus:** record evidence and establish the data model — **not** build a sophisticated mastery algorithm. Exact automatic mastery-update algorithms are **intentionally deferred** (Phase 4/6).

Optional Phase 2 behaviors:

1. Onboarding self-report may set ConceptState to `INTRODUCED` / `DEVELOPING` with EXPLICIT provenance for selected weak topics
2. Study interactions write LearningEvidence; ConceptState auto-updates from OBSERVED rules are stubbed/hooks only
3. Ship write APIs + onboarding self-report; tutor-driven mastery updates deferred

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

### Selection heuristics (Phase 2 — prefer reliable sources)

Priority order:

1. Explicit interaction focus (concept/class/task IDs if provided)
2. Relevant topic/concept from **reliable** focus (explicit IDs preferred)
3. Active misconceptions for those concepts
4. High-confidence preferences affecting assistance mode
5. Active goals
6. Recent relevant evidence
7. Stop when token/context budget reached

**Phase 2 must not** build a sophisticated or unreliable semantic retrieval system merely to satisfy “topic matching.”

Prefer:

- explicit `conceptIds`
- explicit class/task context when available (Phase 3+)
- explicit user-selected focus

If simple keyword matching is included as an early fallback, define it as **best-effort and non-authoritative**. Weak keyword matches must not cause incorrect mastery/context to be treated as fact. Sophisticated semantic concept resolution remains future work.

### Student context is untrusted data (prompt-injection boundary)

Any student-generated or AI-derived information stored in StudentAttribute, StudentGoal, StudentObservation, LearningEvidence, StudentMisconception, onboarding answers, or future imported academic content is **DATA**, not trusted instructions.

`assembleAIContext` must:

- select only **approved** fields (registry / allowlist)
- apply field and length limits (see Appendix B)
- preserve provenance and distinguish EXPLICIT vs OBSERVED/INFERRED
- **not** blindly dump database content into prompts
- **not** allow stored student content to override system policy
- **not** accept client-supplied student facts as trusted truth
- treat free-form student text as **untrusted content**
- preserve the existing AI policy / system hierarchy

**Precedence (always):** system-level safety → academic assistance policy → entitlement / authz → then student context.

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

**Purpose:** Keyed student facts with provenance — **registry-allowlisted keys only**  
**Fields:** `id`, `userId`, `key` (string, namespaced, registry-validated), `valueJson` (Json — schema-validated per key, not arbitrary), `provenance`, `confidence`, `source`, `supersededAt?`, `supersededById?`, `createdAt`, `updatedAt`  
**Indexes:**  
- Partial unique: `(userId, key) WHERE supersededAt IS NULL` — **one active value per user+key**  
- `(userId, key)`, `(userId, supersededAt)` for history queries  
**Ownership:** user  
**Security:** owner-only; client cannot invent keys/provenance/confidence/source; minimize sensitive keys  
**State:** current (filter `supersededAt IS NULL`); history via superseded rows  
**Writes:** server mapping only (onboarding / settings / system); see attribute registry

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
**Fields:** `id`, `userId`, `conceptId?`, `observationId?`, `kind`, `polarity`, `weight`, `source`, `summary` (short, non-transcript), `metadata?`, `createdAt`  
**Indexes:** `(userId, createdAt)`, `(userId, conceptId, createdAt)`  
**Ownership:** user  
**Security:** owner-only; no full chat content  
**State:** historical evidence

#### `StudentObservation`

**Purpose:** Append-only behavioral/academic observations  
**Fields:** `id`, `userId`, `category` (e.g. `study`, `assistance`, `engagement`), `type`, `summary`, `provenance` (usually OBSERVED), `confidence`, `source`, `metadata?`, `createdAt`  
**Indexes:** `(userId, createdAt)`, `(userId, category, createdAt)`  
**Ownership:** user  
**State:** historical

#### `StudentMisconception`

**Purpose:** Track active misconceptions  
**Fields:** `id`, `userId`, `conceptId?`, `statement`, `status`, `provenance`, `confidence`, `source`, `resolvedAt?`, `createdAt`, `updatedAt`  
**Indexes:** `(userId, status)`, `(userId, conceptId)`  
**Ownership:** user  
**State:** current (+ resolved history via status)  
**Note:** no evidence-ID arrays in metadata; future join table if needed (`MisconceptionEvidence`)

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
 → EXPLICIT write
 → supersede prior Attribute/Goal
 → AuditLog profile.updated
```

### Deletion path (technical semantics — not legal retention claims)

Phase 2 introduces significant educational personal data. Intended **technical** deletion semantics:

| Record | On account / data delete |
|--------|--------------------------|
| `StudentProfile` | **Delete** (user-owned) |
| `StudentAttribute` | **Delete** (user-owned, including superseded history) |
| `StudentGoal` | **Delete** |
| `OnboardingSession` / `OnboardingAnswer` | **Delete** |
| `StudentObservation` | **Delete** |
| `LearningEvidence` | **Delete** |
| `StudentConceptState` | **Delete** |
| `StudentMisconception` | **Delete** |
| Global `Subject` / `Topic` / `Concept` (SYSTEM) | **Retain** (shared catalog; not user-owned) |
| USER-created `Concept` owned by user | **Delete** or reassign per policy (prefer delete if unused) |
| `AuditLog` | **Separate treatment** — retain with anonymization / null `userId` or delete after legal review |
| `UsageRecord` | **Separate treatment** — operational/billing telemetry; anonymize or retain per legal review |
| `AIInteraction` | **Separate treatment** — operational; hashed summaries today; anonymize/delete per legal review |

Final retention periods and legal exceptions require privacy/legal review. Do **not** claim these rows satisfy a specific statute.

Technical requirements:

- Deletion must respect ownership and authorization
- Phase 2 implementation includes **cascade / ownership / deletion tests** for all new user-owned records
- Privacy **export** may remain appropriately scoped; **deletion semantics must not be ambiguous**

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
| Privacy notice vs consent | Onboarding notice ≠ legal consent (§4.1) |

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
| **2.0** | Schema + migrations (incl. partial unique active attribute) | Migrate deploy; Prisma generate; no UI yet |
| **2.1** | Repositories/services: attribute registry, goals, provenance rules | Unit tests for registry + one-active-key + precedence |
| **2.2** | Onboarding question catalog (versioned) + server validation + mapping | Answers → attributes/goals; invalid JSON rejected |
| **2.3** | Onboarding UI (multi-step, skip, resume) | Soft gate works; completedAt / skippedAt set |
| **2.4** | Knowledge seed (Subject/Topic/Concept + few relations) | Seed script idempotent |
| **2.5** | StudentConceptState + misconception APIs (self-report) | Owner-scoped CRUD; no auto-mastery from one signal |
| **2.6** | `assembleAIContext` + wire into orchestration | Budgeted, allowlisted, untrusted-data handling |
| **2.7** | Observation/evidence write helpers (hooks; light use) | Tests for non-overwrite / TUTOR_SIGNAL rules |
| **2.8** | Deletion / cascade / ownership tests + privacy checklist | User-owned rows deleted; catalog retained; operational rows policy-documented |
| **2.9** | Integration tests + CI green | IDOR, provenance, onboarding, context budget, entitlements |

Each layer merges only when its criterion is met. **Do not implement any of these in this documentation task.**

---

## 12. Testing strategy (Phase 2 implementation)

### Must test

- Owner isolation (IDOR) on all new user-owned tables
- Attribute registry rejection of unknown keys
- One-active-attribute-per-key under concurrent supersede
- Provenance rules (explicit not overwritten by observation/inference)
- Confidence treated as score (behavior tests), not claimed probability
- Onboarding mapping correctness + answer schema validation
- Skip/resume behavior; session version binding
- Context assembly budget caps + allowlisted fields only
- Untrusted context does not override policy/entitlements (contract-level)
- Orchestration still reserves entitlements (`reserveCapability`)
- Cascade delete / ownership for new student-model tables
- Conservative mastery: single evidence item does not force MASTERED/weak

### Need not test yet

- ML accuracy / calibrated confidence
- Full curriculum coverage
- LMS import fidelity
- Semantic retrieval quality

---

## 13. Risks / tradeoffs

| Risk | Mitigation |
|------|------------|
| Over-building knowledge graph | Cap Phase 2 to Subject/Topic/Concept + 2 relation types; small seed |
| Profile / Attribute becoming a blob | Server-side attribute registry; no arbitrary keys/JSON |
| Onboarding friction | ≤30 Q; skip; soft gate |
| Premature inference / mastery engine | Structure + evidence only; conservative mastery boundary |
| Premature keyword “intelligence” | Explicit focus first; keyword match best-effort only |
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

## 15. Definition of Done (Phase 2 — design readiness + future implementation)

### Design readiness (this PR / documentation)

The architecture revision is ready for **final human architecture review** when the following are specified in docs (not necessarily coded):

1. Schema design fully specified
2. StudentAttribute registry / invariants specified
3. One-active-attribute-per-key invariant specified
4. Provenance rules specified
5. Confidence semantics specified (reliability score, not probability)
6. Onboarding question catalog / versioning specified
7. Onboarding answer validation specified
8. Knowledge catalog specified
9. StudentConceptState semantics specified
10. LearningEvidence and StudentObservation semantics specified
11. Conservative mastery-update boundary specified
12. `assembleAIContext` contract specified
13. Student context explicitly treated as untrusted data
14. Context budget / caps specified
15. Account deletion semantics specified
16. IDOR / ownership requirements specified
17. Provenance tests specified
18. Onboarding mapping tests specified
19. Context budget / security tests specified
20. Cascade / delete tests specified
21. Phase 1 entitlement reservation remains intact (no redesign)
22. Phase 2 non-goals remain out of scope
23. Related docs consistent with this architecture
24. CI / build / typecheck / test expectations defined for implementation

**Claiming design readiness ≠ claiming architecture approval.** Approval is a human decision after review.

### Implementation Done (future — after approval)

Phase 2 implementation is done when the above are realized in code with:

- Approved schema migrated and documented
- Student can complete or dismiss onboarding (≤30 questions)
- Answers persist as EXPLICIT attributes/goals with server-assigned provenance
- Minimal knowledge catalog exists; optional self-reported weak-topic links
- `assembleAIContext` supplies budgeted, allowlisted, untrusted-handled context
- Evidence/observation helpers + isolation / deletion tests
- No entitlement/authz regressions; CI green
- PRIVACY / STUDENT_MODEL docs match implementation
- Explicit non-goals remain out of scope

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

≈ **25** items; mark 10 essential in config.

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

- `docs/PHASE2_ARCHITECTURE.md` (this file — architecture-review tightening)
- `docs/STUDENT_MODEL.md` (aligned to design)
- `docs/IMPLEMENTATION_PLAN.md` (Phase 1 complete; Phase 2 design)
- `docs/AI_SYSTEM.md` (untrusted student context; Phase 2 assembly pointer)
- `docs/ARCHITECTURE.md` (Phase 2 pointer only where needed)

**No application code, schema, or migrations changed.**

## Appendix D — Remaining items for human decision (not blockers to review)

These are intentional open points for final architecture review — not invitations to expand Phase 2 scope:

1. Exact final attribute-key catalog naming (`pref.*` vs `preference.*`, `habit.*` vs `study.*`) — preserve existing conventions unless a single namespace is preferred.
2. Whether `supersededById` is mandatory on Attribute rows or optional when partial unique + timestamps suffice.
3. Exact anonymization strategy for `AuditLog` / `UsageRecord` / `AIInteraction` after legal review (technical delete vs anonymize).
4. Whether Phase 2 ships any keyword-match fallback at all, or explicit-focus-only until Phase 3/4.
