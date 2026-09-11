# Phase 4 Architecture — Production AI + Guided Study Intelligence

**Status:** ARCHITECTURE / PRODUCT PLANNING — remediation after PR #14 independent review (NOT CLEAR FOR MERGE); awaiting re-review — implementation NOT STARTED  
**Baseline:** `main` after PR #13 merge (Academic AI Context Integration)  
**Date:** 2026-09-11 (remediated)  
**Scope of this document:** planning only — no production feature code, no migrations

**Review remediation note:** This revision corrects four MEDIUM findings from the PR #14 independent review: live proposal-type inventory, current vs target learning-first policy, required bounded Class/Task retrieval before production AI, and concept-context / MVP vs fuller DoD clarity. Product direction is unchanged.

---

## 1. Executive Summary

Phases 0–3 delivered an authenticated academic product shell: Student Model, confirmation-gated AI write-back, Classes/Tasks/Calendar, and Study orchestration with learning-first policy — **all still powered by a stub AI provider**.

**Phase 4 objective:** enable the first *real* learning-first Study experience by:

1. Plugging a **production LLM provider** into the existing `AIProvider` abstraction (minimum safe foundation), then  
2. Delivering **guided Study intelligence** — hints, stepwise guidance, check-work / attempt loops — that uses existing academic + Student Model context and may emit **confirmation-gated proposals** only for types the live contract already supports (see §11).

**Production AI is not Phase 4 by itself.** It is the **first prerequisite slice** of Phase 4. The product outcome of Phase 4 is measurable guided tutoring on Study, not an AI platform.

**First real AI experience selected:** guided / adaptive tutoring on the existing Study path (not general chat, not RAG document analysis, not a full mastery engine).

Phase 4 intentionally excludes RAG, embeddings, vector DBs, LMS integrations, billing implementation, teacher/parent systems, autonomous agents, and major UI redesigns.

---

## 2. Current System Capability

### What Flux Labs can actually do today (product)

| Capability | Status |
|------------|--------|
| Register / login / session auth | Working |
| Onboarding → Student Model attributes/goals | Working |
| Classes, Tasks, Calendar UI + domain services | Working |
| Study chat with intents (explain, hint, steps, check work, etc.) | Working end-to-end **with stub replies** |
| Optional Study focus `classId` / `taskId` (server-validated) | Server path exists; **Study UI does not yet send focus** |
| Academic workspace context in AI assembly | Working (PR #13) |
| AI proposals → student confirm/reject → Student Model write-back | Working (stub-generated proposals possible in tests/path) |
| Entitlement reserve, usage accounting, trial budget | Working (against stub costs) |
| Real LLM responses | **Not available** |
| Document upload / RAG | Not built |
| Spaced retrieval / practice engine | Not built |
| Stripe / paid conversion | Not built (plans modeled only) |
| LMS / external calendar sync | Not built |
| Teacher / parent / admin | Not built |

### Architectural capabilities that already exist

- Session-bound authorization (no client-controlled `userId`)
- `AIProvider` interface + DI swap (`getAIProvider` / `setAIProvider`)
- Task routing → internal model keys (`flux-fast` / `standard` / `advanced`)
- Academic assistance policy with learning-first *intent* (see §9.3 for **current vs target** mode selection — `refuse_direct_completion` / `limited_answer` exist as types but are **not** selected by today’s policy)
- Budgeted `assembleAIContext` (profile, Student Model slices, academic workspace, optional validated `conceptIds`)
- Prompt fencing: student/workspace text as **DATA**, not instructions
- Response validation + proposal extraction path for the **four live proposal types** (see §11)
- Confirmation-gated write contracts (`docs/AI_WRITE_CONTRACT.md`)
- Usage records + AI interaction summaries (truncated)
- In-memory rate limiting (single-instance assumption)
- Knowledge Subject → Topic → Concept schema (thin catalog; little seed data). **When Study sends server-validated `conceptIds`, those concepts and related concept-state slices are assembled today.** Ambient keyword concept discovery is not implemented.

### What a student can accomplish today

1. Create an account and complete onboarding.  
2. Manage classes, tasks, and see deadlines on Calendar.  
3. Open Study and receive **stub** guided-looking replies that do not teach real subject matter.  
4. Confirm/reject proposals when the path emits them (limited practical value under stub).

**Bottom line:** Flux is a coherent academic OS shell with a learning-first *contract*, but **no real tutoring intelligence**.

---

## 3. Product Gap

The largest product gap is not missing Classes UI polish or missing Stripe — it is that **the core learning loop cannot execute** because the AI provider is a stub.

Secondary gaps (important but not Phase 4 primary):

- Study UI can send `conceptIds` (assembled when valid) but does **not** yet pass `classId` / `taskId` focus → class/task academic grounding is ambient/server-default rather than task-selected in the UX.
- Knowledge catalog remains thin; concept focus is explicit-ID only (no search/resolution).
- Chat history is browser-session only (acceptable for Phase 4 MVP; durable chat is not required to prove thesis).
- No document grounding (acceptable to defer; premature RAG would dominate cost/complexity).
- `listClasses` / `listTasks` used by academic AI assembly remain **unbounded at the domain query** (in-memory truncation after fetch) — **must be bounded before production real-AI enablement** (see §19 Slice 6).

Without real AI, further academic surface area (more widgets, more integrations) does not increase learning value.

---

## 4. Learning-Loop Analysis

Target loop:

```text
Acquire → Understand → Organize → Connect → Retrieve → Apply → Evaluate → Refine
```

| Stage | Phase 0–3 support | Phase 4 contribution |
|-------|-------------------|----------------------|
| Acquire | Manual class/task entry; no docs | Out of scope (docs → later phase) |
| Understand | Study intents + policy exist; stub answers | **Primary:** real guided explanation / teach modes |
| Organize | Classes/Tasks/Calendar | Optional focus wiring; no new organizer product |
| Connect | Concept links on tasks (explicit); no AI graph | Light: server-validated focus concepts only; no RAG |
| Retrieve | Not built | Out of scope as a practice engine |
| Apply | Check-work / homework-guidance intents exist | **Primary:** real check-work / stepwise apply loops |
| Evaluate | LearningEvidence tables + ConceptState + proposals exist | **Secondary (post-MVP ok):** proposals from live types only (see §11) |
| Refine | Misconceptions + proposal confirm path | **Secondary:** confirmation-gated `MISCONCEPTION_SIGNAL` / cautious `CONCEPT_STATE_UPDATE` |

Phase 4 should **materially improve Understand / Apply / Evaluate** via real guided Study — not invent Acquire (docs) or full Retrieve (spaced practice) yet.

---

## 5. Candidate Capability Evaluation

### A. Production AI infrastructure

| Criterion | Assessment |
|-----------|------------|
| Student value | Indirect alone; **blocking prerequisite** for all learning AI |
| Learning contribution | Enables learning; does not itself teach |
| Architectural dependency | Highest — everything AI-dependent waits on this |
| Complexity | Medium if scoped tightly (one provider, existing interface) |
| Privacy / security | High sensitivity (egress of student text to vendor) |
| AI cost | Introduces real COGS; must bind to entitlements |
| Validate with students | Required before claiming product value |
| Core thesis | Necessary but not sufficient |
| Unlocks later | Yes — tutoring, practice, docs, agent all need it |

**Verdict:** **Must be Slice 0 / first prerequisite of Phase 4** — not the entire phase, not delayed, not a multi-vendor platform.

### B. Study intelligence (guided tutoring)

| Criterion | Assessment |
|-----------|------------|
| Student value | **Highest near-term** — Study becomes useful |
| Learning contribution | Directly targets Understand / Apply / Evaluate |
| Dependency | Requires A |
| Complexity | Medium — leverage existing policy/router/Study UI |
| Privacy / security | Same egress as A; prompt-injection rises with real models |
| Cost | Controllable via maxTokens + entitlements + model routing |
| Validate | Easy A/B: stub vs real guided sessions |
| Thesis | **Core** — guide reasoning, don’t complete work |
| Unlocks | Live proposal types (`MISCONCEPTION_SIGNAL`, etc.) become meaningful under real tutoring |

**Verdict:** **Primary Phase 4 product objective** after A.

### C. Knowledge / learning engine

| Criterion | Assessment |
|-----------|------------|
| Student value | High eventually; weak today without tutoring content |
| Learning | Strong for Retrieve / Connect long-term |
| Dependency | Needs real AI + richer concept usage; catalog seeding |
| Complexity | High if full spaced-repetition / mastery algorithms |
| Thesis | Important, but hollow without real tutoring first |

**Verdict:** **Defer** automated mastery / spaced review engines. Allow **light** concept-aware tutoring (existing focus concepts + optional bounded concept labels in context) only if needed for guided Study. Full knowledge engine → post–Phase 4 / Phase 6 territory.

### D. Academic content (docs / notes / RAG)

| Criterion | Assessment |
|-----------|------------|
| Student value | High for Acquire |
| Complexity / cost / privacy | High (uploads, retention, injection surface, embeddings temptation) |
| Premature? | **Yes** for Phase 4 — no demonstrated requirement to prove thesis |

**Verdict:** **Reject for Phase 4.** Remains later (historical Phase 5).

### E. Academic agent / productivity

| Criterion | Assessment |
|-----------|------------|
| Student value | Deadline awareness useful; proactive agent risks spam/cost |
| Learning | Secondary to tutoring |
| Dependency | Needs real AI + notification infra |

**Verdict:** **Reject** proactive agent / reminders. Optional: Study replies may *mention* upcoming deadlines already in assembled calendar context — not a new agent product.

### F. Integrations (LMS / Google / Microsoft)

| Criterion | Assessment |
|-----------|------------|
| Value | Convenience, not learning thesis |
| Complexity / security / privacy | Very high |

**Verdict:** **Reject for Phase 4.**

### G. Business infrastructure (Stripe)

| Criterion | Assessment |
|-----------|------------|
| Value | Needed before scale monetization |
| Learning | None |
| Timing | Product must prove learning value first; entitlements already enforce trial |

**Verdict:** **Reject for Phase 4** (keep Phase 9 billing). Strengthen usage enforcement under real costs as part of A/B — not Stripe.

### H. Teacher / parent / admin

| Criterion | Assessment |
|-----------|------------|
| Value | Institutional — not student learning loop |
| Privacy | Major consent/visibility issues |

**Verdict:** **Reject for Phase 4.**

---

## 6. Chosen Phase 4 Objective

**Phase 4 = Production AI foundation + Guided Study Intelligence**

Deliver:

1. **Minimum production AI infrastructure** behind the existing `AIProvider` interface.  
2. **First meaningful learning experience:** learning-first **guided tutoring** on Study (hints, steps, check-work, teach/explain under policy).  
3. **Student Model feedback (bounded):** real tutoring may emit **PENDING proposals** only for the **four live proposal types** (`ATTRIBUTE_UPDATE`, `GOAL_UPDATE`, `CONCEPT_STATE_UPDATE`, `MISCONCEPTION_SIGNAL`) through the existing confirmation-gated write-back path — no silent mutations; no Observation/LearningEvidence proposal types today (see §11).  
4. **Study focus UX:** wire optional `classId` / `taskId` from Study UI so academic context is task-grounded (concept `conceptIds` focus already works when the UI sends them).  
5. **Cost / entitlement hardening** under real token spend.  
6. **Required bounded Class/Task retrieval** before production real-AI enablement (see §19 Slice 6).

### Critical question answers

**Should production AI be Phase 4 itself?**  
No — it is **the first prerequisite slice** of Phase 4.

**First real AI experience?**  
**Guided / adaptive tutoring on Study** (policy-driven assistance modes), not general chat, not document analysis, not a full mastery tracker, not retrieval-practice product.

**Why this is the smallest thesis-proving capability:**

- Produces **measurable learning value** (student gets real subject help).  
- Creates **useful Student Model evidence** via existing proposal pipeline.  
- Possible **without RAG/embeddings**.  
- Value is **immediately understandable** in Study.  
- Costs stay **bound** by existing trial entitlements + maxTokens + internal model keys.

---

## 7. Why This Objective Wins

1. **Unblocks the product.** Every other AI feature is theater until the stub is replaced.  
2. **Fits the architecture that exists.** Orchestration, policy, context, proposals, entitlements are already built for this path.  
3. **Proves the thesis.** Learning-first policy only matters when a real model might otherwise dump answers.  
4. **Avoids premature platforms.** One provider, one product surface (Study), no multi-agent, no vector DB.  
5. **Sequences correctly.** Knowledge engines, docs, agents, billing, and integrations all benefit from a proven tutoring COGS profile and safety posture.

---

## 8. Explicit Non-Goals

Phase 4 will **not**:

- Add RAG, embeddings, or vector databases  
- Build a spaced-repetition / recommendation engine  
- Expand into a broad knowledge-graph product  
- Implement multi-agent or autonomous agent systems  
- Add LMS or external calendar integrations  
- Implement Stripe / subscriptions / invoices  
- Build teacher, parent, or school admin surfaces  
- Build a massive document/notes system  
- Persist durable chat history as a product feature (browser-session continuity remains)  
- Major marketing UI redesign, wallpaper customization, or home widgets  
- Claim “cheat-proof” behavior  
- Support client-selected models or client-supplied provider keys  
- Silently write Student Model or Class/Task data from AI output  

---

## 9. Architecture

### 9.1 High-level

```text
Study UI (intent + optional classId/taskId)
    → session auth
    → entitlement reserve (server)
    → rate limit
    → router (task type + internal model key)
    → academic assistance policy (mode)
    → assembleAIContext (Student Model + academic workspace + focus)
    → buildPrompt (SYSTEM/POLICY ≫ DATA fences ≫ user turn)
    → AIProvider.complete()   ← Phase 4: real provider (was stub)
    → validate response
    → usage + AI interaction summary
    → optional PENDING proposals
    → client renders reply; confirm/reject proposals separately
```

### 9.2 Provider layer (minimum)

Keep `AIProvider` in `src/lib/ai/types.ts`.

Add one production adapter (planning name: `HttpChatCompletionsProvider` or vendor-specific class behind factory), selected by **server env** (e.g. `AI_PROVIDER=openai|anthropic|stub`).

Requirements:

- Map internal `InternalModelKey` → vendor model IDs via **server config** (not hard-coded into product UI).  
- Timeouts (hard deadline).  
- Bounded retries (idempotent-safe; no unbounded loops).  
- Normalize token usage into existing `AICompletionResult`.  
- Estimate `estimatedCostMicros` from configurable price tables (planning assumptions until validated).  
- On provider failure: structured error to orchestration; **no entitlement silence** — define fail-closed vs release reserved units (open decision; prefer predictable student messaging + correct accounting).  
- Stub remains default for local/CI without secrets.

**Do not** require multi-provider routing, cascading fallbacks across vendors, or a model marketplace in Phase 4.

### 9.3 Study intelligence layer — current vs Phase 4 target

**Product thesis (unchanged):** guide student reasoning; do not simply complete academic work.

**Current policy behavior (`decideAssistancePolicy` in `src/lib/ai/policy.ts`):**

Modes actually returned today:

- `explain`
- `check_work`
- `hint`
- `break_into_steps` (including when the student asks for a direct answer / homework completion — current default for those asks)
- `teach`

**Not selected today (types exist on `AssistanceMode` but policy never returns them):**

- `refuse_direct_completion`
- `limited_answer`
- also unused today: `ask_question`, `identify_misconception`, `analogous_example`, `partial_assistance`

So learning-first behavior today is primarily **prompt directive + mode `break_into_steps` / `hint` / `check_work`**, not an active refuse/limited-answer selector. That is **insufficient to claim** refuse/limited-answer enforcement is operational.

**Phase 4 target (Slice 2 — required for MVP learning-first claim):**

- Prefer `hint` / `break_into_steps` / `ask_question` / `check_work` / `identify_misconception` for tutoring turns.
- When the student asks for completed homework / final answers, policy must select `refuse_direct_completion` or `limited_answer` (with golden tests).
- Strengthen prompt contracts so real models honor learning-first behavior (tests + golden prompt fixtures).
- Optional UX: structured tutoring turns (question → attempt → feedback) **without** a new multi-agent runtime — single completion calls, UI-orchestrated loops.

**Do not claim** learning-first tutoring is fully operational until Slice 2 lands against a real (or fixture-backed) model path.

### 9.4 Focus wiring

Study client may send optional `classId` / `taskId` already accepted by the server. Phase 4 includes UI affordances to set focus from Classes/Tasks context. Server remains source of truth for ownership validation (PR #13 behavior).

### 9.5 Knowledge / concepts

No new mastery algorithm.

**Already live:** when the client sends server-validated `conceptIds`, `assembleAIContext` includes those catalog concepts and related concept-state slices (allowlisted, DATA-fenced). Study UI already supports sending concept focus.

**Phase 4 optional deepening (not MVP-blocking):** include already-linked task concepts when `taskId` focus is set, if product review finds tutoring quality needs it — still allowlisted fields only, still DATA-fenced. No keyword concept resolution. No Observation/LearningEvidence proposal types.

---

## 10. Data Flow

```text
1. Authenticated Study request
2. Server binds userId from session
3. Entitlement check/reserve for AI capability
4. Validate message + intent + optional focus IDs
5. Load budgeted context (DB, owner-scoped)
6. Serialize context as structured student_data
7. Call provider with system+policy+data+history+user
8. Provider returns text (+ usage)
9. Validate/sanitize assistant content
10. Persist usage_records + truncated ai_interactions
11. Extract proposals (if any) → PENDING only
12. Return reply + proposal summaries to client
13. Separate confirm/reject actions mutate Student Model under write contract
```

**Trust boundary:** browser may send message text, intent, focus IDs. Browser must **never** send assembled context blobs, prior system prompts, entitlement claims, or target user IDs.

---

## 11. Student Model Interaction

### 11.1 Live AI proposal types (source of truth: `src/lib/ai/proposals/schema.ts`)

| Type | Status |
|------|--------|
| `ATTRIBUTE_UPDATE` | Implemented — PENDING → confirm/reject |
| `GOAL_UPDATE` | Implemented — PENDING → confirm/reject |
| `CONCEPT_STATE_UPDATE` | Implemented — PENDING → confirm/reject (mastery caps apply; AI cannot mint MASTERED) |
| `MISCONCEPTION_SIGNAL` | Implemented — PENDING → confirm/reject |

There are **no** AI proposal types named Observation or LearningEvidence today. Phase 4 must not invent them to match older planning language.

### 11.2 Distinctions

| Category | What it is | Phase 4 rule |
|----------|------------|--------------|
| **A. Live proposal types** | The four types above | Only these may be emitted/ingested as AI proposals |
| **B. Student Model evidence/observation stores** | Domain tables/services for observations, learning evidence, etc. (read path / non-AI writers) | May be **read** into context under budgets; AI does **not** write them via proposals unless/until a future contract adds types |
| **C. Future / out of Phase 4 MVP** | New proposal kinds, automated mastery, RAG-grounded evidence | Explicit future work — not implied by this architecture |

### 11.3 Phase 4 write rules

| Path | Phase 4 rule |
|------|----------------|
| Read | Existing `assembleAIContext` budgets; minimize PII; no raw dumps |
| Write from AI | **Proposals only** (live four types) → student confirm/reject |
| Provenance | AI-derived proposals remain non-EXPLICIT; confidence is internal |
| Attributes / Goals | Confirmation-gated; tutoring should prefer not to spam these initially |
| Concept state / mastery | No automated mastery engine; only via `CONCEPT_STATE_UPDATE` + Phase 2 rules |
| Misconceptions | Via `MISCONCEPTION_SIGNAL` only |
| Observations / LearningEvidence | **Not** AI-writable via proposals today |
| Classes / Tasks | **No AI writes** in Phase 4 |

Historical evidence remains distinct from current state (Phase 2 invariant).

**Slice 5 default preference:** emit `MISCONCEPTION_SIGNAL` (and optionally cautious `CONCEPT_STATE_UPDATE`) before Attribute/Goal updates. Do not add Observation/LearningEvidence proposal types in Phase 4 unless a separate approved contract change lands.

---

## 12. AI Provider Strategy

| Decision | Choice |
|----------|--------|
| Abstraction | Keep `AIProvider` |
| Vendors at launch | **One** production provider + stub |
| Selection | Server env / config |
| Model product abstraction | Internal keys only |
| Structured output | Prefer constrained JSON **only** where proposal extraction already needs it; otherwise plain text + existing validators |
| Observability | Latency, tokens, cost micros, success/failure already modeled — ensure real provider fills them |
| Pricing | Treat vendor rates as **planning assumptions** until verified at implementation time |

**Minimum foundation to support guided Study:**

- Secure API key handling (server-only env)  
- Timeout + limited retry  
- Token/cost accounting into existing tables  
- Failure mapping  
- Capability to run stub in CI  

**Not in minimum foundation:** multi-region routing, fine-tuning, batch APIs, image/document multimodal (unless a later slice explicitly needs it — Phase 4 default is text-only).

---

## 13. Context Strategy

Reuse Phase 2/3 assembly:

- Allowlisted fields only  
- Budgets already defined for academic workspace (max classes/tasks/calendar window)  
- Student Model slices remain budgeted  
- Prior chat: browser-session, capped (unchanged)  
- All student/workspace text fenced as DATA  
- Policy/system always outrank context  

Phase 4 additions:

- Ensure Study UI can supply focus IDs  
- Review MEDIUM follow-ups from PR #13 (bounded list queries; minimize redundant IDs) as **hardening slices**, not new product features  
- Do **not** add embeddings or retrieval layers  

Data minimization: prefer names/titles/status/due dates over long descriptions when budgets tighten under real token costs.

---

## 14. Write / Proposal Boundaries

Unchanged from Phase 2 contracts:

- AI output is untrusted  
- No direct Prisma writes from provider adapters  
- Proposal create → PENDING  
- Confirm/reject endpoints enforce session ownership + schema validation  
- High-impact fields remain confirmation-gated  

Phase 4 must add tests that **real-provider-shaped** outputs (verbose, partially compliant JSON, injection attempts in assistant text) cannot bypass validators.

---

## 15. Entitlement and Cost Controls

### Existing levers (keep)

- Trial session counters  
- Soft AI budget ceiling (~$2.00 trial envelope — configurable; see `docs/BILLING.md` / `docs/ECONOMICS.md`)  
- Server-side plan capabilities  
- `maxTokens` on completion requests (today ~800 in orchestration — revisit under real models)  
- Internal model key routing (prefer `flux-fast` for default Study)

### Phase 4 requirements

- Real `estimatedCostMicros` must be **conservative** (prefer overestimate for budget enforcement).  
- Hard fail when entitlement/budget exhausted — no silent unlimited provider calls.  
- Per-user rate limits must remain effective under real latency (consider durable limiter if multi-instance deploy — open decision).  
- Essential learning UX: when budget exhausted, show clear upgrade/trial messaging; do not corrupt Student Model.  
- Design so **learning-first modes are not gated behind a separate “smart” entitlement** that leaves students with only answer-dumping modes — prefer gating total AI sessions/budget, not pedagogy quality.

### Planning-level cost model (assumptions — not live quotes)

| Component | Planning range |
|-----------|----------------|
| Fixed infra | Existing app/DB; + negligible provider account overhead |
| Input tokens / Study turn | ~1.5k–4k (context + history + user) |
| Output tokens / Study turn | ~200–600 (guided; capped by maxTokens) |
| Requests / active student / day | ~5–20 Study turns (wide range) |
| Retries | ≤1–2 on transient failure; budget must count failed paid attempts or explicitly refund — decide in slice |
| Trial exposure | Target ≤ ~$1 avg; envelope ~$1.50–$2.00 / trial user (`docs/ECONOMICS.md`) |
| Paid-user exposure | Enforce plan allowances; design toward **60%+** gross margin, aspirational **70–80%** |
| Docs/images | **$0 in Phase 4** (text-only) |

**Margin note:** With trial AI COGS bounded near $1–2 and paid plans priced for margin after acquisition, Phase 4 must instrument actual COGS/user before locking prices (Phase 9).

---

## 16. Privacy / Security Requirements

### 16.1 Security risks (address before/during Phase 4)

| Risk | Severity | Notes / mitigation |
|------|----------|--------------------|
| Prompt injection via student/workspace text under real models | **HIGH** | Strengthen fencing, policy priority, refusal tests; never elevate DATA to instructions |
| Sensitive student-data egress to provider | **HIGH** | Minimize context; vendor DPA/retention review; no training on customer data where contractually available |
| Entitlement bypass / unpaid provider calls | **HIGH** | Reserve-before-call; tests for exhausted trial; no client trust |
| Forged client context / prior history elevation | **MEDIUM** | Continue rejecting client-supplied system prompts/context blobs; history capped & role-filtered server-side |
| Proposal/write-back abuse (spam confirms, forged proposal IDs) | **MEDIUM** | Ownership checks; rate limits; validators |
| IDOR on focus class/task IDs | **MEDIUM** | Keep PR #13 ownership validation; regression tests |
| In-memory rate limit weak on multi-instance | **MEDIUM** | Document limitation; durable limiter before horizontal scale |
| Accidental persistence of full prompts/PII in logs | **MEDIUM** | Truncation policy for `ai_interactions`; never log full system+data dumps |
| Provider timeout / retry amplifying cost | **MEDIUM** | Hard timeouts; retry budget; cost accounting on failures |
| Unauthorized Student Model writes | **LOW→MED** | Existing confirm path; add adversarial output tests |
| “Cheat-proof” overclaim | **LOW** (product) | Docs/UI must not claim cheat-proof |

### 16.2 Privacy / minor users (not legal advice)

Separate tracks:

**Engineering requirements**

- Data minimization in prompts  
- Owner isolation / deletion semantics preserved  
- Export/delete hooks remain compatible  
- Clear retention for AI logs (short, truncated)  
- Configurable provider region/retention where offered  

**Policy / product decisions**

- Age gates / parental consent flows timing  
- Whether schools are in-scope for early cohorts  
- What is shown in truncated AI logs to support staff  

**Questions requiring legal review (before production minors/schools)**

- COPPA / parental consent  
- FERPA if school-mediated  
- State student privacy laws  
- GDPR / UK GDPR (lawful basis, DPIA, subprocessors)  
- Provider training/retention/opt-out terms  
- Cross-border transfer mechanisms  

Phase 4 is **not** a legal-compliance implementation phase, but production AI **raises** the urgency of that review versus stub-only.

---

## 17. Testing Strategy

| Layer | Focus |
|-------|--------|
| Unit | Provider adapter mapping, cost estimation, timeout/error normalization |
| Contract | Prompt still fences DATA; policy modes; no client identity trust |
| Orchestration | Reserve → call → usage; failure accounting; stub vs real factory |
| Authz | Focus IDOR; proposal confirm IDOR |
| Adversarial | Injection strings in user message, class description, task title |
| Entitlement | Budget exhaustion blocks provider call |
| Golden / snapshot | Learning-first refusals for “just give me the answers” |
| CI | Default stub provider; no live network required |
| Optional live | Gated integration test behind secret + explicit env flag |

Do not require paid API calls in default CI.

---

## 18. Migration Requirements

**Phase 4 architecture anticipates:**

- **Likely no schema migration** for the minimum provider slice (env + code).  
- **Possible small migrations** only if implementation proves need for e.g. provider request id storage, durable rate-limit tables, or richer usage dimensions — **not authorized by this doc alone**.  
- Any migration requires its own implementation PR review.  

**This planning PR creates zero migrations.**

---

## 19. Implementation Slices

Do **not** implement these now. Prefer small PRs.

### Slice 0 — Production AI provider adapter (prerequisite)

- **Responsibility:** Real `AIProvider` implementation + factory; stub default for CI.  
- **Scope:** Env config, model-key mapping, timeout, retry policy, token/cost fill-in, error mapping.  
- **Deps:** None (uses existing interface).  
- **Security:** Secrets server-only; no key leakage to client; log redaction.  
- **Tests:** Adapter unit tests with mocked HTTP; factory selection; CI remains stub.  
- **DoD:** Orchestration can complete a Study turn via real provider in a controlled env; stub path unchanged for CI.  
- **User-visible:** Still feature-flag/env gated until Slice 1 UX polish — may be internal-only initially.

### Slice 1 — Entitlement & cost hardening under real spend

- **Responsibility:** Correct reserve/consume/failure accounting with real `estimatedCostMicros`.  
- **Scope:** Budget enforcement, conservative cost tables, exhausted-trial UX copy.  
- **Deps:** Slice 0.  
- **Security:** No unpaid calls; race-safe reserve.  
- **Tests:** Exhausted budget; concurrent requests; overestimate behavior.  
- **DoD:** Trial envelope cannot be exceeded by successful or retried calls beyond defined policy.  
- **User-visible:** Clear messaging when AI unavailable due to limits.

### Slice 2 — Learning-first prompt & policy hardening for real models

- **Responsibility:** Ensure real models follow guidance-not-completion; wire currently unused refuse/limited modes.  
- **Scope:** Prompt/policy revisions so `decideAssistancePolicy` selects `refuse_direct_completion` or `limited_answer` when the student asks for completed work; refusal fixtures; assistance-mode reinforcement.  
- **Deps:** Slice 0 (can develop against stub + recorded fixtures).  
- **Security:** Injection regression suite.  
- **Tests:** Golden cases proving cheat-request paths select refuse/limited modes (not only `break_into_steps`); DATA fence invariants.  
- **DoD:** Documented current-vs-target behavior; automated tests that refuse/limited modes are selected for direct-completion asks; no “dump full essay” on default homework asks.  
- **User-visible:** Study replies feel like tutoring, not answer keys.

### Slice 3 — Study focus UX (`classId` / `taskId`)

- **Responsibility:** Let students ground Study in a class/task (concept `conceptIds` focus already works).  
- **Scope:** UI to pass focus IDs; deep-link from task pages; display focus chip.  
- **Deps:** PR #13 server path (already on main).  
- **Security:** No client context blobs; server ownership only.  
- **Tests:** UI wiring + existing IDOR tests remain green.  
- **DoD:** Selecting a task focuses Study; AI context includes that task when authorized.  
- **User-visible:** Task-aware Study sessions.

### Slice 4 — Guided tutoring loop UX (single-completion turns) — post-MVP polish ok

- **Responsibility:** Make Understand/Apply loops obvious (attempt → hint → check-work).  
- **Scope:** Study UI patterns for stepwise intents; not a new agent runtime. Existing intents (`hint` / `steps` / `attempt` / `check_work`) already support a thin loop.  
- **Deps:** Slices 0–2 (3 strongly recommended).  
- **Security:** Same orchestration path only.  
- **Tests:** Intent routing; mode selection; session continuity caps.  
- **DoD:** Student can complete a guided problem-solving session without leaving Study.  
- **User-visible:** Clear tutoring flow.  
- **MVP note:** Not required to prove thesis if intents + Slice 2 already deliver guided behavior; valuable UX polish.

### Slice 5 — Meaningful proposal generation from tutoring (post-MVP ok)

- **Responsibility:** Emit high-quality PENDING proposals from real sessions using **only live types**: prefer `MISCONCEPTION_SIGNAL`, optionally cautious `CONCEPT_STATE_UPDATE`; avoid Attribute/Goal spam.  
- **Scope:** Tighten extraction/validation for existing four types; **do not** add Observation/LearningEvidence proposal types.  
- **Deps:** Slices 0–2.  
- **Security:** Proposal validators resist malformed/injected assistant JSON.  
- **Tests:** Confirm/reject; forged proposal IDs; provenance checks; reject unknown proposal types.  
- **DoD:** Students see confirmable learning insights after sessions; nothing auto-writes.  
- **User-visible:** “Save to your learning profile?” style confirmations.

### Slice 6 — Bounded Class/Task retrieval (**REQUIRED before production real-AI enablement**)

- **Responsibility:** Server-side bounded Class/Task retrieval for AI context assembly (addresses PR #13 MEDIUM).  
- **Scope:** Domain `take`/`limit` (or equivalent) on `listClasses` / `listTasks` paths used by academic AI assembly; deterministic ordering; explicit maximum result sizes; no client-controlled arbitrary expansion; predictable AI context budgets; protect against unexpectedly large academic workspace payloads. Further data minimization (trim redundant IDs) as needed.  
- **Deps:** None beyond main; **may land before or in parallel with Slice 0**, but is a **hard gate** for enabling real AI against academic workspace data in production.  
- **Security / cost:** Reduces over-fetch, memory pressure, and least-privilege data to provider.  
- **Tests:** Budget/unit tests for list limits; assembly still returns deterministic slices.  
- **DoD:** AI assembly cannot pull unbounded Class/Task sets from the database; production real-AI flag/env must not be enabled without this.  
- **User-visible:** None required (quality/cost/safety).  
- **Not optional:** Do not treat this as deferrable polish after production AI launch.

---

## 20. Definition of Done

Architecture/planning alone (this PR) is **not** Phase 4 complete.

### 20.1 Phase 4 MVP / first real AI package (thesis proof)

MVP is complete when:

1. Production provider works behind `AIProvider` with stub retained for CI (Slice 0).  
2. Entitlements/budgets enforce real cost envelopes; fail-accounting policy decided (Slice 1).  
3. Learning-first policy **actually selects** `refuse_direct_completion` / `limited_answer` (or equivalent tested refuse path) for direct-completion asks; guided Study on existing authenticated Study flow delivers real tutoring (Slice 2).  
4. Bounded Class/Task retrieval is in place — **required gate** before production real-AI enablement (Slice 6).  
5. Required academic context continues to flow through `assembleAIContext` (workspace + Student Model + existing `conceptIds` focus when provided).  
6. Security regressions (IDOR, injection fences, entitlement) pass; no unpaid provider calls.  
7. No RAG/embeddings/billing/LMS/teacher systems shipped.  
8. Docs accurately reflect slice merge state.

**Strongly recommended with MVP (not blocking thesis if delayed briefly):** Study `classId`/`taskId` focus UX (Slice 3).

**Not required for MVP thesis proof:** Slice 4 UX polish; Slice 5 proposal-quality work (existing confirm path may remain quiet initially).

### 20.2 Fuller Phase 4 package (after MVP)

Additional Phase 4 slices that deepen the product but are **not** prerequisites for claiming first real AI value:

- Slice 3 class/task focus UX (if not already shipped)  
- Slice 4 guided-loop UX polish  
- Slice 5 high-quality live-type proposal generation  

### 20.3 Explicitly later (not Phase 4 DoD)

- RAG / embeddings / vector DB / document systems  
- Advanced mastery / spaced-repetition intelligence  
- Broader adaptive engines  
- Proactive agent behavior  
- LMS / Stripe / teacher-parent-admin  

Independent review must clear each implementation slice before merge.

---

## 21. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Real models ignore learning-first policy | Thesis failure / academic integrity harm | Slice 2 prompts + tests; limited-answer modes; human eval |
| COGS exceed trial envelope | Margin / abuse | Conservative estimators; hard caps; monitoring |
| Provider outage | Study useless | Clear errors; stub only for non-prod; optional later single-provider retry |
| Privacy incident via prompt content | Legal/trust | Minimization; legal review before minors at scale |
| Scope creep into RAG/agents | Delay thesis proof | Enforce non-goals in review |
| Overbuilding multi-provider platform | Wasted complexity | One provider until COGS/quality known |

---

## 22. Open Decisions

1. **Which single production vendor** for first adapter (OpenAI vs Anthropic vs other) — choose at Slice 0 with current pricing/DPA, not in this planning PR.  
2. **Entitlement accounting on provider failure** after reserve (consume vs release) — decide as Slice 1 entry criteria.  
3. **Feature flag** strategy for enabling real AI in production vs staging — must also gate on Slice 6 completion.  
4. **Durable rate limiting** timeline (before multi-instance).  
5. Whether Slice 5 initially emits only `MISCONCEPTION_SIGNAL` or also `CONCEPT_STATE_UPDATE` (Attribute/Goal updates discouraged early). Observation/LearningEvidence proposal types are **out of scope** unless a separate contract change is approved.  
6. Exact `maxTokens` / context budget tightening under measured token use.  
7. Age-gate / consent timing relative to first production AI cohort (legal + product).  
8. **Ordering only:** Slice 6 may land before or parallel to Slice 0, but production real-AI enablement is blocked until Slice 6 is done (not optional).

---

## 23. Phase 5 Dependencies

Assuming historical roadmap naming (resources / document intelligence):

Phase 4 outputs that Phase 5 will need:

- Proven provider adapter + cost controls  
- Measured token COGS for Study turns  
- Hardened prompt-injection posture  
- Confidence that learning-first policy works with real models  
- Clear entitlement patterns for expensive capabilities  

Phase 5 should still **not** start until Phase 4 guided Study is validated. Document ingestion must not bypass Phase 4 non-goals by stealth.

---

## Appendix A — First-principles answers (concise)

1. **What can Flux do today?** Academic shell + stub Study.  
2. **What exists architecturally?** Full AI orchestration without a real brain.  
3. **What can a student accomplish?** Organize schoolwork; not yet learn via AI.  
4. **Largest gap?** Stub AI.  
5. **Most learning value next?** Real guided Study tutoring.  
6. **Prerequisites for later?** Production provider + cost/safety posture.  
7. **Not now?** RAG, LMS, billing, parents/teachers, agents, mastery engines.  
8. **Debt before expansion?** Prompt-injection hardening under real models; entitlement/cost correctness; **required** PR #13 query bounds (Slice 6) before production real AI; rate-limit durability before scale.

## Appendix B — Relationship to older plan text

Older `IMPLEMENTATION_PLAN` phrasing (“Phase 4: Core AI tutoring”) remains directionally correct. This document **re-grounds** that phase in post–Phase 3 reality: academic context exists; provider is still stub; production AI is a **prerequisite slice**, not the whole product outcome.
