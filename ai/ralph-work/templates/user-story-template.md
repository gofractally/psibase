# User Story Template: Psibase Context

Use this template for individual user stories within a psibase PRD. Each story maps to one Ralph iteration when `passes: false`.

---

## ID & Title

**ID:** US-XXX  
**Title:** [Short, action-oriented title]

---

## Description

**As a** [user type: end user, admin, developer, system]  
**I want** [specific capability]  
**So that** [measurable benefit]

---

## Component Type

| Type | Check one |
|------|-----------|
| Service | ☐ |
| Plugin | ☐ |
| UI | ☐ |
| Query service | ☐ |
| Multiple | ☐ (list: ___) |

*Determines which `ai/skills/` to load and build verification steps.*

---

## Acceptance Criteria

- [ ] [Criterion 1 - specific, testable]
- [ ] [Criterion 2]
- [ ] **Service builds via make:** `cd build && make <package-name>` succeeds *(if service)*
- [ ] **Plugin WASM compiles:** Plugin package builds without errors *(if plugin)*
- [ ] **UI renders correctly:** No build errors, component loads *(if UI)*
- [ ] [Any psibase-specific checks: table created, action callable, etc.]

---

## Priority

**Priority:** [1 = highest, 2 = next, etc.]

---

## Dependencies

**Blocked by:** [US-XXX, US-YYY] — must complete first

*Stories with dependencies should have lower priority or be ordered after their blockers.*

---

## Relevant Skills

Skills are **area-based**. Set `skills` in prd.json to the area(s) that match what’s needed (e.g. service tables → `service-tables`). The agent uses the story text to pick the right action subsection inside each area doc.

| Area skill | When to use |
|------------|-------------|
| `service-tables` | Table storage: add table, add field, add index, modify table |
| `service-actions` | On-chain actions, pre-actions, calling other services |
| `service-graphql` | GraphQL queries for a service |
| `plugin-wasm` | Plugin logic: add function, wire WIT, call Supervisor |
| `plugin-dependencies` | Adding a dependency to a plugin (Cargo + .wit + code) |
| `ui-supervisor-integration` | UI calling plugins, preload, transactions |
| `build-system` | Add package, make targets, debug build |
| `wit-interfaces` | Define/extend WIT (world.wit, impl.wit) |
| `service-testing` | Writing or running service tests |

*List the area skill name(s) that match this story, e.g. `["plugin-wasm"]` or `["service-tables", "service-actions"]`.*

---

## Notes

- [Implementation hints]
- [Gotchas from similar past work]
- [Links to relevant docs or examples]

---

## prd.json Story Object

When converting to `prd.json`:

```json
{
  "id": "US-XXX",
  "title": "...",
  "priority": 1,
  "passes": false,
  "type": "service|plugin|ui|query-service",
  "acceptance_criteria": ["...", "..."],
  "dependencies": ["US-YYY"],
  "skills": ["plugin-wasm"]
}
```
