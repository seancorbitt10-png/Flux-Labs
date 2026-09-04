# Onboarding Specification

**Status:** DESIGN SPEC — UI not implemented; server catalog foundation may be a subset
**Authority:** Subordinate to `docs/PHASE2_ARCHITECTURE.md` (human-approved) §4 / Appendix A
**Catalog version (target):** `2026-09-phase2`
**Related:** `docs/ENGINEERING_NON_NEGOTIABLES.md`, attribute registry, onboarding domain services

---

## 1. Purpose

Finalize onboarding **design** before UI implementation:

- ~**22–26** questions (≤30 hard cap)
- Academic setup for better assistance — **not** a personality survey
- Soft gate; AI works with degraded context if skipped
- **Not** the legal consent mechanism

---

## 2. Scope

**In scope:** Question catalog design, mappings, completion/skip/resume/edit rules, privacy boundaries.

**Out of scope:** Building onboarding UI, legal consent/COPPA flows, LMS course import, psychometrics.

---

## 3. Definitions

| Term | Meaning |
|------|---------|
| **Setup information** | Gate/profile fields needed for product setup (e.g. academic level) |
| **Student Model facts** | Persistent attributes / concept self-reports with provenance |
| **Goals** | `StudentGoal` rows (and optional `goalsSummary` convenience) |
| **Temporary / session-only** | Stored on `OnboardingAnswer` with mapping `none` — no Attribute write |
| **Essential** | Asked in the core path; still **skippable** (cost: weaker personalization) |
| **EXPLICIT** | Server-assigned provenance for answered onboarding mappings |

### Separation rule

Do **not** force every answer into `StudentAttribute`.

| Bucket | Storage |
|--------|---------|
| Setup | `StudentProfile` fields ± mirrored Attribute |
| Student Model facts | Registry Attributes only |
| Goals | `StudentGoal` (± profile `goalsSummary`) |
| Temporary preferences / free text for later | `OnboardingAnswer` only (`mapping: none`) until a registry key exists |

---

## 4. Anti-patterns (forbidden questions)

Do **not** ask or store:

- Visual / auditory / kinesthetic “learning styles”
- Personality typing as product truth
- Psychological / medical diagnosis framing
- Fixed intelligence or permanent ability labels
- Unsupported cognitive-style claims
- Legal consent / privacy-authorization quiz items

---

## 5. Versioning & validation

| Rule | Detail |
|------|--------|
| Source of truth | Server-controlled versioned catalog only |
| Session binds | `OnboardingSession.version` |
| Client cannot invent | `questionId`, schemas, mapping targets, attribute keys, provenance, confidence |
| Validation | Server Zod/schema; reject unknown IDs, wrong types, oversized payloads |
| `answerJson` | Validated payload storage only — never arbitrary unvalidated JSON |

---

## 6. Categories (target ~24)

| Cluster | Theme | Count | Maps primarily to |
|---------|-------|------:|-------------------|
| A | Academic environment | 3–4 | Profile + `academic.*` |
| B | Current courses / subjects | 3–4 | `academic.subjects` + session-only detail |
| C | Academic goals | 3–4 | `StudentGoal` + `goalsSummary` |
| D | Workload / constraints | 2–3 | Attributes / session-only |
| E | Study habits & workflow prefs | 3–4 | `habit.*` / `pref.*` / `approach.*` |
| F | Help areas / challenges | 3–4 | `challenge.*` / `intent.*` / session-only |
| G | Optional interaction prefs | 2–3 | `pref.*` / session-only |

Privacy/legal consent: **zero** questions in this catalog.

---

## 7. Essential setup set (must ask; may skip)

These nine are **essential** (aligned with architecture §4). Skipping is allowed; personalization degrades.

1. Academic level
2. Primary subjects this term
3. Top goal for using Flux
4. Biggest current academic challenge
5. Assistance style (hints / explain / check-work)
6. Explanation length (concise / detailed)
7. Guided participation default
8. Success this month
9. Typical weekly study time

**Why essential:** They initialize assistance policy + academic framing without requiring psychometrics or full course graphs.

**Completion rule:** `COMPLETED` may be set when the student finishes the flow (including skips). Do **not** require every essential answer to be non-skipped for account use. Soft gate only.

---

## 8. Question catalog (design target)

Answer types: `enum` | `string` | `string_array` | `boolean`.
Unless noted, answered mappings → provenance **EXPLICIT**, source `onboarding`.
Later edit via settings → EXPLICIT supersede (one-active attribute / goal update).

Legend for **Persistent?**:

- `profile` / `attribute` / `goal` = Student Model / setup persistence
- `answer_only` = onboarding session record only

### Cluster A — Academic environment

| ID | Question | Essential? | Skip? | Type | Allowed / max | Maps to | Persistent? | Privacy | Later change |
|----|----------|:----------:|:-----:|------|---------------|---------|-------------|---------|--------------|
| `academic.level` | What is your academic level? | Y | Y | enum | `hs` \| `undergrad` \| `grad` \| `other` | Profile.academicLevel + Attr `academic.level` | profile+attribute | Low | Settings supersede attribute + profile |
| `academic.setting` | Where are you primarily learning? | N | Y | enum | `high_school` \| `college` \| `self_directed` \| `other` | none | answer_only | Low | Re-answer / new session; no Attribute |
| `academic.target_band` | Roughly when is your next major academic milestone? | N | Y | enum | `this_month` \| `this_term` \| `this_year` \| `unsure` | none | answer_only | Low | answer_only |
| `academic.year_band` | What year/level band are you in? | N | Y | string | max 80 | none | answer_only | Low | answer_only |

### Cluster B — Courses / subjects

| ID | Question | Essential? | Skip? | Type | Allowed / max | Maps to | Persistent? | Privacy | Later change |
|----|----------|:----------:|:-----:|------|---------------|---------|-------------|---------|--------------|
| `academic.subjects` | Which subjects are you focusing on this term? | Y | Y | string_array | 1–12 items, each ≤80 | Attr `academic.subjects` | attribute | Low–med | Supersede attribute |
| `academic.hardest_class` | What feels hardest right now? | N | Y | string | max 300 | none | answer_only | Med | answer_only (Phase 3 may promote) |
| `course.list_optional` | Optional: list current course names | N | Y | string_array | max 8 × 80 | none | answer_only | Med | answer_only; Class entities are Phase 3 |
| `exam.soon` | Do you have a major exam within 2 weeks? | N | Y | boolean | true/false | none | answer_only | Low | answer_only |

### Cluster C — Goals

| ID | Question | Essential? | Skip? | Type | Allowed / max | Maps to | Persistent? | Privacy | Later change |
|----|----------|:----------:|:-----:|------|---------------|---------|-------------|---------|--------------|
| `goal.primary` | What is your top goal for using Flux? | Y | Y | string | max 300 | StudentGoal category=`primary` | goal | Low | New/updated goal; do not AI-replace |
| `goal.secondary` | Any second goal? | N | Y | string | max 300 | StudentGoal category=`secondary` | goal | Low | Same |
| `goal.success_month` | What would success look like this month? | Y | Y | string | max 300 | Profile.goalsSummary | profile | Low | Settings edit profile field |
| `goal.org_vs_understanding` | Prioritize organization or deeper understanding right now? | N | Y | enum | `organization` \| `understanding` \| `both` | none | answer_only | Low | answer_only |

### Cluster D — Workload / constraints

| ID | Question | Essential? | Skip? | Type | Allowed / max | Maps to | Persistent? | Privacy | Later change |
|----|----------|:----------:|:-----:|------|---------------|---------|-------------|---------|--------------|
| `habit.typical_weekly_time` | About how many hours do you study in a typical week? | Y | Y | enum | `under_3h` \| `3_to_6h` \| `6_to_10h` \| `10_to_15h` \| `over_15h` | Attr `habit.typical_weekly_time` | attribute | Low | Supersede |
| `constraint.time_pressure` | Are you under significant time pressure this term? | N | Y | boolean | | none | answer_only | Med | answer_only |
| `constraint.notes` | Anything Flux should know about your schedule limits? | N | Y | string | max 300 | none | answer_only | Med | answer_only |

### Cluster E — Habits & workflow preferences

| ID | Question | Essential? | Skip? | Type | Allowed / max | Maps to | Persistent? | Privacy | Later change |
|----|----------|:----------:|:-----:|------|---------------|---------|-------------|---------|--------------|
| `pref.assistance_style` | How should Flux help by default? | Y | Y | enum | `hints_first` \| `explain_first` \| `check_work_first` | Attr + Profile.preferredAssistanceStyle | profile+attribute | Low | Supersede |
| `pref.explanation_length` | Concise or detailed explanations? | Y | Y | enum | `concise` \| `detailed` | Attr `pref.explanation_length` | attribute | Low | Supersede |
| `pref.guided_participation` | Push guided participation by default? | Y | Y | boolean | | Attr `pref.guided_participation` | attribute | Low | Supersede |
| `habit.session_length` | Typical study session length? | N | Y | enum | `under_25m` \| `25_to_50m` \| `50_to_90m` \| `over_90m` | none | answer_only | Low | Promote to Attr only after registry add |
| `approach.worked_example` | Do worked examples usually help you? | N | Y | boolean | | Attr `approach.worked_example` | attribute | Low | Supersede; **not** a learning style |

### Cluster F — Help areas / challenges

| ID | Question | Essential? | Skip? | Type | Allowed / max | Maps to | Persistent? | Privacy | Later change |
|----|----------|:----------:|:-----:|------|---------------|---------|-------------|---------|--------------|
| `challenge.primary` | Biggest current academic challenge? | Y | Y | string | max 200 | Attr `challenge.primary` | attribute | Med | Supersede |
| `challenge.shaky_topics` | Topics that feel shaky (optional)? | N | Y | string_array | max 8 × 80 | none | answer_only | Med | Later concept links — no keyword resolver now |
| `intent.priority` | What should Flux prioritize first? | N | Y | string | max 300 | none | answer_only | Low | answer_only |
| `interest.primary` | Subject/topic that interests you most? | N | Y | string | max 200 | Attr `interest.primary` | attribute | Low | Supersede |

### Cluster G — Optional interaction prefs

| ID | Question | Essential? | Skip? | Type | Allowed / max | Maps to | Persistent? | Privacy | Later change |
|----|----------|:----------:|:-----:|------|---------------|---------|-------------|---------|--------------|
| `interest.secondary` | Another interest? | N | Y | string | max 200 | Attr `interest.secondary` | attribute | Low | Supersede |
| `pref.avoid` | Anything Flux should avoid in tone/approach? | N | Y | string | max 300 | none | answer_only | Med | answer_only |
| `context.motivation` | Optional: what motivates you this term? | N | Y | string | max 300 | none | answer_only | Med | answer_only; no psych framing |

**Count:** 26 items (within 22–26 target / ≤30 cap). Foundation code may ship a **subset**; UI slice should converge on this catalog version.

---

## 9. Completion, skip, resume, dismiss

| State | Behavior |
|-------|----------|
| unanswered | No `OnboardingAnswer` row |
| skipped | `skipped=true`; **no** Attribute/Goal write |
| answered | Validated payload; server mapping may write EXPLICIT state |
| IN_PROGRESS | Resume by loading session + answers |
| DISMISSED | Soft gate later; set `onboardingSkippedAt`; AI degraded OK |
| COMPLETED | Set `onboardingCompletedAt` + `onboardingVersion` |

**Skipped entirely / dismissed:** Student can use Flux; `assembleAIContext` uses whatever EXPLICIT data exists (possibly none).

**Minimum path:** Architecture allows dismiss after soft gate; do not hard-block AI.

---

## 10. Re-onboarding / editing

| Event | Rule |
|-------|------|
| Settings edit of attribute | EXPLICIT supersede via one-active `(userId, key)` invariant |
| New onboarding version | New session with new `version`; do not corrupt old answers |
| Conflicting OBSERVED later | Keep EXPLICIT; append observation; never silent overwrite |
| Goal edits | Update/create goals via server; AI cannot replace |

---

## 11. Privacy & consent boundary

| Concern | Treatment |
|---------|-----------|
| Academic onboarding | This catalog only |
| Privacy / data-use notice | Separate product copy/flow — **not** a quiz question |
| Legal consent | Separate compliance flow after legal review |
| Completing onboarding | **Does not** establish legal consent / COPPA / GDPR / FERPA satisfaction |

**Code ≠ compliance.**

---

## 12. Security

- Ownership from authenticated session
- Server validates all answers
- No client-chosen provenance/confidence/keys
- Free-text answers are untrusted student data in later AI context

---

## 13. Explicit non-goals

- Consent mechanism
- Learning-style quiz
- Full Class/Enrollment capture (Phase 3)
- Automatic concept tagging via keyword/LLM resolver

---

## 14. Open questions

**OPEN DECISION REQUIRED:** Whether `habit.session_length` / `intent.*` / `context.*` remain `answer_only` until attribute registry keys are added, or keys are added in the same UI implementation slice.

| | |
|--|--|
| **Why it matters** | Affects whether UI slice requires registry expansion |
| **Recommended** | Keep as `answer_only` until registry PR adds keys; do not invent Attribute keys in the client |
| **Alternatives** | Expand registry in same slice as UI |
| **Consequences** | answer_only avoids registry sprawl; registry expansion enables AI context eligibility sooner |
