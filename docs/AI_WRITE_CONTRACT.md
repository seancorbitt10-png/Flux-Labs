# AI Write / Proposal Contract

**Status:** CONTRACT — design only; proposal pipeline not implemented
**Authority:** Subordinate to `docs/PHASE2_ARCHITECTURE.md` (human-approved)
**Related:** `docs/AI_CONTEXT_CONTRACT.md`, `docs/ENGINEERING_NON_NEGOTIABLES.md`

---

## 1. Purpose

Define how future AI-generated educational suggestions interact with persistence.

Core principle:

> **AI output is a PROPOSAL.**
> **AI PROPOSAL ≠ AUTOMATIC PERSISTENCE.**
> **AI INFERENCE ≠ AUTHORITATIVE STUDENT FACT.**

Conceptual pipeline (future):

```
AI response
  → Structured proposal (parsed, typed)
  → Server validation (schema / allowlists)
  → Authorization / ownership (authenticated actor)
  → Provenance assignment (server only)
  → Confidence assignment (server only)
  → Persistence decision (accept / reject / defer)
  → Student Model write via domain services
```

Do **not** implement this pipeline in the current documentation task.

---

## 2. Scope

**In scope:** Rules for AI → Student Model writes when feature-flagged hooks exist.

**Out of scope:** Implementing hooks, MisconceptionEvidence join, mastery algorithms, RAG, embeddings, LMS import.

Default Phase 2 posture: **AI write-back hooks off** unless explicitly enabled and tested.

---

## 3. Definitions

| Term | Meaning |
|------|---------|
| **Proposal** | Structured, server-parsed suggestion derived from model output |
| **Persistence decision** | Server chooses store / reject / ignore / queue for review |
| **EXPLICIT** | Student-authoritative provenance; **never** minted by AI confidence |
| **TUTOR_SIGNAL** | Evidence kind from model judgment; **not** EXPLICIT; does not auto-set mastery |
| **Domain service** | Existing server modules (`recordStudentObservation`, `recordLearningEvidence`, etc.) |

---

## 4. Proposable vs server-controlled fields

### 4.1 AI may propose (content)

| Proposal type | Example content AI may suggest |
|---------------|--------------------------------|
| Observation | category/type/summary *candidate* |
| Misconception | statement text *candidate*; optional suggested conceptId if server-known |
| LearningEvidence | kind/polarity/summary *candidate*; optional conceptId if server-known |
| Goal | title/description *candidate* |
| Concept association | suggested conceptId from **known IDs only** |
| Tutoring recommendation | ephemeral coaching hint (often **not** persisted) |

### 4.2 AI must NEVER control (authority / identity / security)

| Field / concern | Rule |
|-----------------|------|
| `userId` / ownership | Derived from authenticated session only |
| `createdByUserId` | Derived from authenticated actor for USER concepts; AI cannot set |
| `provenance` | Server-assigned from write channel; AI cannot choose EXPLICIT |
| `confidence` | Server-assigned from policy defaults |
| `source` / authority classification | Server channel allowlist |
| Arbitrary `StudentAttribute.key` | Registry only; AI inference writers are usually **none** in Phase 2 |
| SYSTEM catalog ownership / mutation | System actor only; AI cannot create Subjects/Topics/SYSTEM Concepts |
| Entitlement / billing / trial counters | Untouchable by AI proposals |
| Security metadata (IP hashes, audit forgery) | Untouchable |
| `supersededAt` / registry metadata | Server only |

---

## 5. Provenance rules for AI writes

| Rule | Detail |
|------|--------|
| No EXPLICIT from AI | Model confidence, tone, or “I’m sure” **never** yields EXPLICIT |
| Default AI-backed records | Prefer `OBSERVED` (instrumented behavior) or `INFERRED` / `HYPOTHESIS` (interpretation) |
| Attribute writes from AI | Phase 2: **generally forbidden**. If ever allowed later, must use `writer: "system"` with **non-EXPLICIT** provenance and must not overwrite EXPLICIT |
| Student EXPLICIT path | Onboarding / settings only (authenticated student-authoritative flows) |

---

## 6. Entity-specific rules

### 6.1 Observations

- AI may propose observation **content**; server maps to an allowlisted channel.
- Persist only via domain service that assigns provenance/confidence/source.
- Append-only; never rewrite history.
- Observation alone does **not** mutate ConceptState or Attributes.

### 6.2 LearningEvidence

- AI may propose evidence summaries / polarity / kind candidates.
- `TUTOR_SIGNAL` is allowed as evidence kind but **≠ EXPLICIT** and **≠ mastery**.
- **EVIDENCE ≠ MASTERY.**
- Recording evidence must not auto-set `StudentConceptState.mastery = MASTERED`.
- No DB ID arrays in metadata; no fake JSON relationships.

### 6.3 Misconceptions

- Model suggesting a misconception does **not** establish it as fact.
- Persist as OBSERVED/INFERRED/HYPOTHESIS with appropriate confidence, or reject.
- Do not present to the student as diagnosed fact without EXPLICIT confirmation or stronger policy.
- **No** embedding evidence IDs in misconception metadata.
- Future `MisconceptionEvidence` join is **deferred** (architecture); document as future requirement if audit linking is needed.

### 6.4 Goals

- AI-suggested goals are proposals; persist as EXPLICIT **only** after student accepts via settings/UI.
- Never silently replace student-stated goals with AI guesses.

### 6.5 StudentConceptState / mastery

- AI must **never** directly declare MASTERED because the model “thinks” the student understands.
- Allowed Phase 2 ConceptState mutations remain: EXPLICIT self-report / settings correction (server-mapped).
- Sophisticated mastery algorithm: **deferred**.
- Any future mastery update requires explicit server-side educational policy — not raw model judgment.

### 6.6 StudentAttributes

- AI must not invent keys.
- AI must not write EXPLICIT attributes.
- Weak inference must not overwrite EXPLICIT (precedence policy).

### 6.7 Concept association

- Until a real concept resolver exists, concept references in proposals must be **server-validated concept IDs** already known to the application.
- **Forbidden in Phase 2:** RAG, embeddings, keyword matching, LLM concept resolution call to invent IDs.

---

## 7. Persistence decision matrix

| Validation outcome | Action |
|--------------------|--------|
| Schema invalid / unknown type | **Reject** |
| Unauthorized / wrong owner | **Reject** |
| Policy violation (EXPLICIT minting, mastery jump) | **Reject** |
| Contradicts EXPLICIT current state | **Reject** persistence of conflicting current-state write; optional observation-only note if explicitly designed |
| Feature flag off | **Ignore** (no write) |
| Valid, low-risk append-only evidence/observation | **Accept** via domain service |
| Valid but high-impact current-state change | **Defer** / require student confirmation (future UX) — default reject in Phase 2 if ambiguous |

---

## 8. Transaction & failure behavior

| Rule | Detail |
|------|--------|
| AI failure | Must not corrupt Student Model |
| Partial writes | Forbidden for multi-step unauthorized proposals; prefer single domain-service calls in transactions |
| Provider timeout/error | No Student Model mutation from the failed call |
| Entitlement reserve failure | No AI call; no proposal writes |
| Orchestration success + write-hook failure | Log safely; do not roll back the user’s visible answer unless product policy says otherwise — but **never** leave half-applied authority upgrades |

---

## 9. Auditability

| Requirement | Rule |
|-------------|------|
| Traceability | Where AI-generated rows are persisted, prefer linking to originating `AIInteraction` / session via a **dedicated future relation**, not arbitrary ID arrays in unrelated JSON metadata |
| Metadata | Auxiliary non-relational only |
| MisconceptionEvidence | Deferred join table if/when needed |
| AuditLog | Use for significant student-model corrections / onboarding events; do not invent legal retention policy |

**Future architectural requirement (not implemented now):**
Dedicated join or foreign key from proposal-originated Student Model rows → `AIInteraction.id` (or session id), rather than stuffing IDs into free-form metadata.

---

## 10. Security / authorization

1. Authenticated actor only.
2. `assertResourceOwner` (or equivalent) on every student-owned write.
3. No cross-user proposal targeting.
4. No AI control of catalog SYSTEM mutations.
5. No AI control of entitlements/billing/security.
6. Client cannot smuggle provenance/confidence through “AI proposal” wrappers.

---

## 11. Explicit non-goals

- Autonomous profiling bots
- Silent identity rewriting from chat
- Learning-style labels from model output
- Mastery declaration from one tutor signal
- Semantic/RAG concept invention

---

## 12. Open questions

**OPEN DECISION REQUIRED:** Exact persistence UX for high-impact AI proposals (auto-store low-risk observations vs always confirm).

| | |
|--|--|
| **Why it matters** | Affects whether Phase 4 write-back can persist without student confirmation |
| **Affected** | Observation/evidence hooks, settings UX |
| **Recommended** | Phase 2/early Phase 4: feature-flagged; default **off**; if on, allow only append-only OBSERVED evidence/observations with strict caps; require confirmation for goals/attributes/concept-state |
| **Alternatives** | Always confirm all; or auto-store all low-risk |
| **Consequences** | Confirmation-first is safer; auto-store needs stronger monitoring |

This does **not** reopen the ban on AI minting EXPLICIT or auto-MASTERED.
