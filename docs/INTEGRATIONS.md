# Integrations

## Principle

Flux Labs is an intelligence layer that **connects to** LMS/SIS/calendar/drive systems — it does not replace them.

## Abstraction (future)

```
IntegrationProvider
  authenticate(oauth)
  listCourses()
  listAssignments()
  ...
```

Core domain (`Class`, `Assignment`, `Task`, …) stays provider-agnostic.

## Rules

- Modular — core must work with zero integrations
- Never assume access without authorization
- Do not fake connectors

## Phase

Connectors start in **Phase 8**, prioritized by real user demand (likely Canvas or Google Classroom first).
