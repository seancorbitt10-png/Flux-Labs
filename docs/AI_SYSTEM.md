# AI system

## Pipeline

```
User request
 → Authentication
 → Authorization
 → Entitlement / usage policy
 → Task routing
 → Academic assistance policy
 → Context assembly (profile today; Phase 2+ Student Model / Knowledge — budgeted)
 → Model selection (internal keys)
 → Provider call
 → Structured response
 → Usage + interaction logging
 → (Phase 2+) optional student evidence / observation hooks (feature-flagged)
```

See `docs/PHASE2_ARCHITECTURE.md` for the designed context-selection layer (not implemented yet).

Entrypoint: `src/lib/ai/orchestration.ts`

## Routing

`src/lib/ai/router.ts` classifies into task types (tutoring, homework guidance, concept explanation, etc.) and selects an internal model key:

- `flux-fast`
- `flux-standard`
- `flux-advanced`

Students never pick models. Vendor model names are not the product abstraction.

## Academic assistance policy

`src/lib/ai/policy.ts` is the **only** place that decides assistance mode (hint, steps, check work, teach, refuse direct completion, etc.).

Positioning language: *AI that guides instead of doing the work.* Never claim “cheat-proof.”

## Provider abstraction

`AIProvider` interface in `src/lib/ai/types.ts`.

Phase 1: `StubAIProvider` exercises the full path (entitlement → route → policy → usage).

Phase 4: real providers (OpenAI/Anthropic/etc.) behind the same interface, with fallback and cost routing.

## Security notes for AI

- Retrieved document text (future) is untrusted data, not instructions.
- Onboarding text, goals, attributes, observations, evidence, misconceptions, and imported student info are **DATA**, not instructions.
- Conceptual priority: SYSTEM/SAFETY/POLICY → AI policy → trusted app state (authz/entitlements) → **untrusted student context** → current user request.
- `assembleAIContext` (Phase 2 design) must allowlist fields, apply budgets, use structured serialization, preserve provenance, and not dump the DB or raw chat into prompts.
- Phase 2 must not rely on low-quality keyword matching for concept selection.
- AI output cannot bypass entitlement or authz checks.
- `TUTOR_SIGNAL` / model-derived evidence must not become EXPLICIT truth or bypass update/mastery rules.
- Usage telemetry avoids storing full student content.
