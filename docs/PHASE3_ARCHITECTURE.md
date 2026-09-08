# Phase 3 Architecture — Classes / Tasks / Calendar

**Status:** HUMAN-APPROVED DESIGN — implementation authorized in small slices after independent review
**Baseline:** `main` @ `1025f6e9f650ec91f807b79f8432842ea9529cf3`
**Date:** 2026-09-08

## 1. Purpose

Phase 3 turns Flux from a student-model + Study workspace into an academic workspace with explicit class, assignment, and deadline context.

The design must preserve the Phase 1/2 rule that the server owns identity, authorization, validation, and consequential writes. Classes and tasks are student-owned application data, not AI-owned state.

### Core relationship

```text
User
 ├── Class[]
 │    └── Task[]
 │          └── TaskConcept[] → Concept
 ├── Student Model
 └── Study

Calendar = a read-side representation of dated academic records.
It is not a second source of truth for task deadlines.
```

## 2. Phase 3 scope

### In scope

- Student-owned classes
- Student-owned academic tasks/assignments
- Task lifecycle and status
- Due dates and optional start dates
- Explicit task ↔ knowledge-concept links
- Class-scoped task views
- Calendar view derived from dated academic records
- Server-side ownership/authz/IDOR protection
- Domain validation and transactional mutation paths
- Deletion/cascade semantics
- Study integration contracts for class/task context
- Mobile-first Classes, Tasks, and Calendar UI
- Tests and audit/security coverage

### Explicit non-goals

Do not add in Phase 3:

- LMS integrations or imports
- Google/Apple/Microsoft calendar integrations
- Real LLM providers
- RAG, embeddings, semantic concept resolution, or extra model calls
- Teacher/admin/parent systems
- General recommendation engines
- Automated mastery algorithms
- Chat persistence
- Generic calendar events unrelated to academic records
- Notifications/reminders infrastructure
- Recurring class schedules or attendance tracking
- Gradebook functionality
- Collaboration/sharing between students

Those can be designed later when their product need is established.

## 3. Data model

### 3.1 Class

`Class` is a student-owned academic course record.

Required fields:

- `id`
- `userId`
- `name`
- `term`
- `status`
- `createdAt`
- `updatedAt`

Optional fields:

- `courseCode`
- `instructorName`
- `description`
- `startsAt`
- `endsAt`

`status` is controlled by the server and should initially be:

- `ACTIVE`
- `ARCHIVED`

Do not create a separate Enrollment table in Phase 3: one student owns their own class records, so a class membership relation would add complexity without a current use case.

Ownership invariant:

> Every Class belongs to exactly one authenticated User. No client can assign or reassign `userId`.

Recommended indexes:

- `(userId, status)`
- `(userId, term)`

Recommended uniqueness:

- Do not globally unique course names/codes; students can have repeated names across terms.
- A reasonable scoped uniqueness candidate is `(userId, term, name)` if UX requires duplicate prevention, but implementation should not make duplicate class names impossible unless the product contract needs it.

### 3.2 Task

`Task` is a student-owned academic obligation. It may belong to a Class, but must remain representable without one so students can track uncategorized work.

Required fields:

- `id`
- `userId`
- `title`
- `status`
- `createdAt`
- `updatedAt`

Optional fields:

- `classId`
- `description`
- `dueAt`
- `startsAt`
- `priority`
- `estimatedMinutes`
- `completedAt`

Controlled `TaskStatus`:

- `TODO`
- `IN_PROGRESS`
- `COMPLETED`
- `CANCELLED`

Status transition rules:

```text
TODO ↔ IN_PROGRESS
TODO → COMPLETED
IN_PROGRESS → COMPLETED
TODO → CANCELLED
IN_PROGRESS → CANCELLED
COMPLETED → TODO / IN_PROGRESS only through an explicit user mutation
CANCELLED → TODO only through an explicit user mutation
```

The exact transition matrix may be simplified in implementation, but the server must validate status values and maintain `completedAt` consistency:

- `COMPLETED` requires `completedAt` to be set by the server.
- Non-completed status must not retain a stale `completedAt`.
- Clients cannot directly control `completedAt`.

Task ownership invariant:

> Every Task belongs to exactly one authenticated User. A `classId`, when present, must reference a Class owned by the same User.

This same-user foreign-key check is mandatory and is the primary defense against cross-user class attachment.

Recommended indexes:

- `(userId, status)`
- `(userId, dueAt)`
- `(userId, classId, dueAt)`

### 3.3 Task ↔ Concept

Use a proper join table, not JSON ID arrays.

`TaskConcept`:

- `taskId`
- `conceptId`
- `createdAt`

Composite uniqueness:

- `(taskId, conceptId)`

Ownership rule:

- Task must belong to authenticated user.
- Concept must be a valid global SYSTEM concept or a USER concept owned by the same authenticated user.
- The client may submit concept IDs, but the server validates every ID before persistence.

Phase 3 does **not** resolve arbitrary task text to concepts. No embeddings, keyword matching, or second AI call.

TaskConcept is an explicit relationship supplied by a trusted product flow/user action. It does not assert mastery.

### 3.4 Calendar representation

Do **not** create a generic `CalendarEvent` table in Phase 3.

For V1, the academic calendar is a read-side projection of:

- Task `dueAt`
- Task `startsAt` when present
- Class `startsAt` / `endsAt` only as optional course-period metadata, not recurring events

The Task remains the source of truth for assignment deadlines. Calendar mutations that change a deadline must call the Task mutation service; Calendar must not own a second copy of the due date.

This prevents synchronization bugs and unnecessary duplication.

## 4. Deletion semantics

### User deletion

All student-owned Classes and Tasks are deleted with the User. TaskConcept rows follow Task deletion.

Global SYSTEM Subjects/Topics/Concepts remain.

USER Concepts remain owned by the user and follow existing Phase 2 deletion semantics.

### Class deletion

Default behavior: deleting a Class is an explicit destructive operation.

- Delete the Class.
- Tasks must **not** be silently deleted if they can exist without a class.
- Therefore `Task.classId` should use `ON DELETE SET NULL`.
- TaskConcept rows remain because the Task remains.

The UI must make this consequence explicit: deleting a class removes the class association from its tasks; it does not delete the tasks.

### Task deletion

Deleting a Task deletes its TaskConcept relationships.

No AI/evidence/student-model row should be implicitly created or mutated merely because a task is deleted.

## 5. Authorization and IDOR requirements

Every Class/Task/TaskConcept read and mutation must derive the authenticated `userId` from the server session.

Never accept client-provided `userId` as authority.

Never authorize access by object ID alone.

Required patterns:

```text
getClass(id)
  → require authenticated user
  → query Class where id AND userId

updateClass(id, input)
  → require authenticated user
  → load/authorize Class by id + userId
  → validate input
  → mutate

createTask(input)
  → require authenticated user
  → if classId exists, verify Class belongs to same user
  → create Task with server userId
```

Avoid `findUnique({ where: { id } })` followed by an unchecked mutation when an ownership-scoped query can enforce the boundary directly.

Return not-found semantics for unauthorized object IDs where practical, avoiding cross-user existence disclosure.

## 6. Validation

Use Zod/server-side schemas for all external mutation inputs.

At minimum validate:

- non-empty bounded names/titles
- bounded descriptions
- controlled enums
- integer priority range
- positive bounded estimated minutes
- valid ISO/Date values
- sensible start/due relationship where both are supplied
- term length
- course code length
- instructor length
- concept ID arrays with bounded size and no duplicates

The server, not the client, is authoritative for:

- `userId`
- timestamps generated by mutations
- `completedAt`
- ownership
- status transition validity

## 7. Study / AI context integration

Classes and tasks must become AI context only through the existing controlled context assembly boundary.

### Required future context shape

```text
trusted focus
student current state
academic workspace context
  classes: small authorized set
  tasks: small authorized set
student historical evidence
user request
```

Academic workspace context is still **student data**, not instructions.

Task descriptions, class names, and other user-entered text are untrusted data. They cannot override AI policy, entitlements, authorization, or the learning-first contract.

### Focused Study requests

Study may later accept a server-validated `classId` or `taskId` focus.

The server must verify ownership before context assembly.

A task focus can cause related class metadata and explicitly linked concepts to be included, subject to context budgets.

A class focus can cause a bounded set of relevant upcoming/incomplete tasks to be included.

Phase 3 should establish the domain/query contracts, but must not bypass `assembleAIContext` or introduce direct prompt construction from database rows.

## 8. Calendar query contract

The calendar UI needs a deterministic read service, not an AI recommendation layer.

Input:

- authenticated user
- date range (`from`, `to`)
- optional class filter
- optional task-status filter

Output:

- dated task records grouped by date
- minimal class display metadata
- no unauthorized records

Date semantics:

- Store timestamps as absolute instants (`DateTime`).
- Interpret/render them using the student's profile timezone at the presentation boundary.
- Do not store duplicated local-date strings as a second deadline source.

The first V1 calendar can be a deadline/timeline calendar rather than a full scheduling product.

## 9. UI boundaries

### Classes

- list active classes
- create/edit/archive/delete
- class detail shows associated tasks
- compact mobile-first cards/list
- no dashboards or decorative analytics

### Tasks

- list/filter by status and class
- create/edit/delete
- mark complete / reopen
- show class, due date, priority, estimated effort
- task detail can show linked concepts

### Calendar

- month or agenda/timeline view; choose the simplest robust mobile implementation
- show task deadlines
- tap-through to task
- filter by class
- no generic event editor in Phase 3

The existing Flux shell remains the visual system: restrained monochrome palette, thin borders, compact spacing, understated branding. Do not introduce a generic SaaS component aesthetic.

## 10. Implementation slicing

### Implementation #1 — Academic workspace data foundation

Implement only:

- Prisma Class / Task / TaskConcept models + enums
- migration
- server domain services
- ownership/authz helpers
- validation schemas
- CRUD/query service contracts needed by later UI
- deletion semantics
- status/completion invariants
- calendar read/query service at domain level
- comprehensive unit/integration tests

Do **not** build the full UI or modify AI orchestration in this slice unless a minimal type/interface change is strictly required.

### Implementation #2 — Classes + Tasks UI

- mobile-first Classes UI
- class CRUD
- task CRUD/filter/status UI
- class/task routes
- route-level authz/IDOR tests

### Implementation #3 — Calendar UI

- calendar/agenda presentation
- date-range queries
- timezone-aware rendering
- class/status filters
- task navigation
- mobile behavior tests

### Implementation #4 — Academic context integration

- extend controlled `assembleAIContext` with authorized class/task context
- server-validated class/task Study focus
- context budgets/minimization
- prompt contract tests
- no direct DB-to-prompt bypass

The exact split can be adjusted only if implementation reveals a concrete dependency, but do not collapse all of Phase 3 into one large PR.

## 11. Testing / security requirements

Every implementation slice must include relevant tests for:

- authenticated access
- cross-user Class IDOR
- cross-user Task IDOR
- cross-user class attachment
- unauthorized concept linkage
- deletion/cascade behavior
- status/completedAt invariants
- validation boundaries
- calendar date-range filtering
- timezone conversion behavior where applicable
- bounded result sizes
- no client-controlled `userId`
- no client-controlled server authority fields

Required quality gates before merge:

- full test suite passes
- typecheck passes
- lint passes
- production build passes
- Prisma migration status is clean/up to date
- independent review has 0 Critical / 0 High findings

## 12. Definition of Done for Phase 3

Phase 3 is complete only when:

1. A student can securely manage their classes.
2. A student can securely manage academic tasks with optional class association.
3. Tasks have a deterministic lifecycle and deadline representation.
4. Calendar displays task deadlines without maintaining a duplicate source of truth.
5. Explicit task/concept relationships are persisted relationally and ownership-validated.
6. Classes/tasks can safely feed Study through controlled context assembly.
7. Cross-user access is blocked at the server boundary.
8. Deletion behavior is explicit and tested.
9. Mobile UI is coherent with the existing Flux shell.
10. No deferred Phase 4+ intelligence or integrations have leaked into the implementation.

## 13. Open decisions intentionally deferred

- Exact class color/tag treatment
- Whether class `startsAt`/`endsAt` survive the final V1 schema if not used by UI
- Month calendar vs agenda-first presentation
- Whether tasks eventually support subtasks
- Whether assignments eventually carry grades/points
- Recurring class meeting events
- LMS/calendar integrations

These are product decisions for later slices, not reasons to block the foundational model.
