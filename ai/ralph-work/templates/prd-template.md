# PRD Template: Psibase Application

Use this template when creating a new Product Requirements Document for a psibase app. Fill in each section; the Ralph loop converts this to `prd.json` for execution.

---

## Project Name

**Name:** [Short project/feature name]

**Description:** [1-2 sentence summary of what this project does]

*Consider: Is this a new app, a feature for an existing app, or a shared component?*

---

## Branch Name

**Branch:** `ralph/[feature-name]`

*The Ralph loop verifies the current git branch matches this before each iteration. Use a descriptive branch name.*

---

## Goals

- [Primary goal 1]
- [Primary goal 2]
- [Secondary goals if any]

*Consider: What user or system problem does this solve? What does "done" look like?*

---

## User Stories

Format each story for conversion to `prd.json`. Include `passes: false` initially.

### US-001: [Story Title]
**As a** [user/actor]  
**I want** [capability]  
**So that** [benefit]

- **Priority:** [1 = highest]
- **passes:** false
- **Acceptance criteria:**
  - [ ] [Criterion 1]
  - [ ] [Criterion 2]

*Consider: Does this story need a new service, plugin, or UI component? Can it extend existing ones?*

### US-002: [Story Title]
...

*Repeat for each user story. Order by priority.*

---

## Functional Requirements

Numbered FR-XXX for traceability.

- **FR-001:** [Requirement]
- **FR-002:** [Requirement]

*Consider: Cross-reference these in user story acceptance criteria where relevant.*

---

## Non-Goals

- [What we are explicitly NOT building in this project]
- [Out of scope items]

*Helps prevent scope creep and keeps the agent focused.*

---

## Technical Considerations

### Psibase Components

| Type | Name | Purpose |
|------|------|---------|
| Service | [name] | [What it does on-chain] |
| Plugin | [name] | [What it bridges to UI] |
| UI | [name] | [What the user sees] |
| Query service | [name] | [GraphQL endpoints if any] |

*Consider: Does this feature need a new service or can it extend an existing one? What tables does it need?*

### Tables (Service Storage)

| Table | Key | Value | Purpose |
|-------|-----|-------|---------|
| [name] | [key type] | [value type] | [What it stores] |

### WIT Interfaces

| Interface | Used by | Purpose |
|-----------|---------|---------|
| [name] | [component] | [What it defines] |

*Consider: WIT files are error-prone. Document the interface design clearly. Escalate if unsure.*

### Dependencies

- [Existing psibase services/plugins this depends on]
- [External APIs or systems]

---

## Testing Strategy

| What | How |
|------|-----|
| Service logic | [Unit tests, integration tests, manual chain deploy] |
| Plugin | [WASM build verification, manual UI test] |
| UI | [Component tests, E2E if applicable] |

*Consider: What can be tested in CI vs. manual verification? See `ai/skills/testing/` for guidance.*

---

## Open Questions

- [ ] [Question 1 - e.g., "Should auth use existing AccountSys or new service?"]
- [ ] [Question 2]

*Resolve these before or during the first iteration. Escalate if blocking.*

---

## Conversion to prd.json

When ready for Ralph, convert this PRD to `prd.json` with structure:

```json
{
  "branchName": "ralph/feature-name",
  "projectName": "...",
  "stories": [
    {
      "id": "US-001",
      "title": "...",
      "priority": 1,
      "passes": false,
      "acceptance_criteria": [...]
    }
  ]
}
```
