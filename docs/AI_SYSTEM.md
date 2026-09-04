# AI system

## Pipeline

```
User request
 → Authentication
 → Authorization
 → Entitlement / usage policy
 → Task routing
 → Academic assistance policy
 → Context assembly (profile today; classes/resources later)
 → Model selection (internal keys)
 → Provider call
 → Structured response
 → Usage + interaction logging
 → (Phase 2+) optional student evidence / observation hooks
 → (Phase 2+) budgeted context assembly from Student Model + Knowledge Foundation
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
- AI output cannot bypass entitlement or authz checks.
- Usage telemetry avoids storing full student content.
