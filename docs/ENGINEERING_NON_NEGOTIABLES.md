# Engineering Non-Negotiables

**Status:** GUARDRAILS — binding for all future Flux Labs implementation
**Authority:** Subordinate to `docs/PHASE2_ARCHITECTURE.md` (human-approved)
**Related:** `docs/AI_CONTEXT_CONTRACT.md`, `docs/AI_WRITE_CONTRACT.md`, `docs/ONBOARDING_SPEC.md`

---

## 1. Purpose

Short, high-signal rules that prevent accidental architectural drift.

If a feature conflicts with these rules, **change the feature**, not the rule — unless the approved architecture is explicitly revised by human decision.

---

## 2. Scope

Applies to Phase 2 and later phases unless a future approved architecture document supersedes a specific rule.

---

## 3. Definitions

| Term | Meaning |
|------|---------|
| **Current state** | What Flux believes now |
| **Historical evidence** | Append-only what happened |
| **EXPLICIT** | Student-authoritative provenance |
| **Proposal** | AI suggestion pending server decision |
| **Untrusted student data** | Student/AI-derived content treated as DATA, never instructions |

---

## 4. Non-negotiables

1. **Server owns authorization.** UI checks are never sufficient.
2. **Client input is untrusted.** Validate schemas, IDs, sizes, and allowlists server-side.
3. **Student-generated content is data, never instructions.** It cannot override system/application policy merely by appearing in a prompt.
4. **EXPLICIT cannot be minted by system inference.** Onboarding/settings (student-authoritative) only; system writers must use non-EXPLICIT provenance.
5. **AI inference cannot silently become authoritative student fact.** Confidence of the model is irrelevant to EXPLICIT authority.
6. **Provenance is server-controlled.** Clients and models cannot choose or upgrade it.
7. **Confidence is an internal reliability/prioritization signal.** Not calibrated probability, diagnosis, psychological measurement, or truth score. Cannot outrank provenance.
8. **Current state is distinct from historical evidence.** Do not treat observations/evidence as automatic current-state truth.
9. **Evidence does not equal mastery.** `LearningEvidence` / `TUTOR_SIGNAL` must not auto-set `MASTERED`.
10. **User-owned educational data has explicit deletion semantics.** Delete/cascade student-owned rows; do not invent legal retention claims.
11. **Global catalog data is distinct from user-owned data.** SYSTEM Subject/Topic/Concept/Relation are not deleted with a student; USER concepts follow owner deletion rules.
12. **AI-generated changes require server validation.** AI output is a proposal, not a write.
13. **AI cannot control ownership or actor identity.** No `userId` / `createdByUserId` from model output.
14. **AI cannot directly change security/entitlement/billing state.**
15. **No learning-style pseudoscience.** No VAK labels, personality typology as product truth, or permanent ability labels from weak inference.
16. **No permanent student labels from weak inference.** Prefer revisable, provenance-tagged beliefs.
17. **No hidden side effects in context assembly.** `assembleAIContext` reads/serializes only.
18. **No unauthorized cross-user data in AI context.** Owner-only student rows; USER concepts only for owner.
19. **No feature gets added merely because an LLM can technically perform it.** Capability ≠ product authorization.
20. **Security invariants are enforced server-side, not through UI behavior.**

---

## 5. Core distinctions (always preserve)

```
CURRENT STATE  ≠  HISTORICAL EVIDENCE
AI INFERENCE   ≠  AUTHORITATIVE STUDENT FACT
AI PROPOSAL    ≠  AUTOMATIC PERSISTENCE
EVIDENCE       ≠  MASTERY
ONBOARDING     ≠  LEGAL CONSENT
```

---

## 6. PHASE 2 SCOPE DISCIPLINE

Deferred — do **not** implement in Phase 2 unless a new human-approved architecture change says otherwise:

| Deferred | Notes |
|----------|-------|
| RAG | No retrieval-augmented generation over documents |
| Embeddings / vector search | No embedding indexes |
| Semantic / keyword concept resolution | No pretended resolvers; server-validated concept IDs only |
| Sophisticated recommendation algorithms | No “Flux recommends” engine |
| Mastery algorithms | Structure + boundaries only; no auto-MASTERED policy engine |
| MisconceptionEvidence join | Deferred relational join; no evidence ID arrays in metadata |
| LMS / SIS integrations | IMPORTED provenance later |
| Billing / Stripe | Phase 9 |
| Deployment / Vercel / domains / App Store | Later |
| Teacher / admin / parent systems | Later |
| Major UI expansion | Onboarding UI is a Phase 2 slice; marketing/polish elsewhere |

Also deferred relative to foundation: full `assembleAIContext` wiring, AI proposal pipeline (default off), knowledge seed content expansion.

---

## 7. Security / authorization checklist (every PR)

Before merging Student Model / AI / onboarding work, verify:

- [ ] Ownership derived from authenticated actor
- [ ] No client-controlled provenance/confidence/source/keys
- [ ] No cross-user reads/writes
- [ ] No EXPLICIT minting by system/AI paths
- [ ] Evidence paths do not auto-master
- [ ] Catalog SYSTEM vs USER rules respected
- [ ] Deletion semantics preserve global catalog
- [ ] No deferred tech smuggled in “just for now”

---

## 8. Explicit non-goals of this document

- Replacing `PHASE2_ARCHITECTURE.md`
- Legal compliance certification
- Implementing the listed deferred features

---

## 9. Open questions

None. This document restates approved invariants; it does not introduce new product architecture.
