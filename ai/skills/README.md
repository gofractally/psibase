# AI Coding Skills for Psibase Ralph

Research summary and strategy document for AI coding skills as they apply to the psibase Ralph system.

---

## 1. What Are AI Coding Skills?

**Skills** are reusable knowledge packages that give AI coding agents domain-specific expertise. They contain:

- Reference documentation
- Patterns and examples
- Gotchas and common pitfalls

…everything needed to execute a specific type of task successfully.

Unlike fine-tuning or post-training, these are **prompt-time skills**—injected into context when relevant. The concept has emerged from practical experience with AI coding agents (Ralph, Cursor rules, Claude AGENTS.md, etc.).

**Key insight:** AI agents perform much better when given focused, relevant domain knowledge than when they have to figure things out from scratch each time.

---

## 2. Skill Structure: Area-Based Dirs, Action-Based Subsections (Hybrid)

**Top-level skills are area-based.** Each skill is a subdirectory under `ai/skills/` named by *area of focus* (e.g. `service-tables`, `plugin-wasm`). That makes it easy to match stories: "this story touches the service table" → `skills: ["service-tables"]`.

**Inside each SKILL.md, use action-based subsections.** Structure the doc so the agent can find the specific move (add table, add field, add index, etc.) under the area. Use clear headings like `### Skill: add-table`, `### Skill: add-field`, `### Skill: add-index`.

```
ai/skills/
├── README.md
├── service-tables/
│   ├── SKILL.md       # sections: add-table, add-field, add-index, modify-table, etc.
│   ├── examples/
│   └── gotchas.md
├── service-actions/
│   ├── SKILL.md       # sections: add-action, add-pre-action, call-other-service, etc.
│   └── gotchas.md
├── service-graphql/
│   ├── SKILL.md       # sections: add-query, add-mutation (if applicable), etc.
│   └── examples/
├── plugin-wasm/
│   ├── SKILL.md       # sections: add-function, wire-wit, call-supervisor, etc.
│   ├── examples/
│   └── gotchas.md
├── plugin-dependencies/
│   ├── SKILL.md       # add-dependency (Cargo.toml + .wit + imports)
│   └── gotchas.md
├── ui-supervisor-integration/
│   ├── SKILL.md       # sections: call-plugin, preload-plugins, handle-transactions, etc.
│   └── examples/
├── build-system/
│   ├── SKILL.md       # sections: add-package, make-targets, debug-build, etc.
│   └── gotchas.md
├── wit-interfaces/
│   ├── SKILL.md       # sections: define-interface, world-vs-impl, extend-wit, etc.
│   └── gotchas.md
└── service-testing/
    ├── SKILL.md       # sections: write-service-test, simulated-chain, etc.
    └── examples/
```

---

## 3. SKILL.md Format

Each `SKILL.md` covers one **area**. At the top, use the standard metadata; then structure the rest by **action** so the agent can jump to the right move.

| Section | Purpose |
|---------|---------|
| **Name** | Area name (e.g. service-tables, plugin-wasm) |
| **When to load** | When this skill should be loaded (e.g. "story involves service tables" → `service-tables`) |
| **Prerequisites** | What skills/knowledge this area depends on |
| **Core Knowledge** | Essential concepts for this area (tables, fracpack, indexes, etc.) |
| **Skill: &lt;action&gt;** | One subsection per concrete action, e.g. `### Skill: add-table`, `### Skill: add-field`, `### Skill: add-index`. Each subsection: what to do, patterns, code references. |
| **Gotchas** | Common mistakes (or link to `gotchas.md`) |
| **Verification** | How to verify work in this area (build, test, deploy) |
| **Related Skills** | Other area skills that often pair with this one |
| **References** | Official docs, codebase examples |

The agent matches the story’s need ("add a field to the accounts table") to the area (`service-tables`) and then to the subsection (`### Skill: add-field`) inside the doc.

---

## 4. Composability Strategy

- **Area skills** are the units the loop loads (one dir per area). Each area’s SKILL.md can reference other areas in "Related Skills" so the agent knows what to read next (e.g. service-tables → service-actions).
- **Actions live inside the area doc** as subsections (e.g. add-table, add-field under service-tables). The agent picks the right subsection from the story text; no need for a separate "composite" skill dir.
- The Ralph loop loads skills based on the current story's `skills` array or `type`/`category` in `prd.json`.
- Multiple area skills can be loaded at once when a story spans areas (e.g. `["service-tables", "plugin-wasm"]`).

---

## 5. How User Stories Look Up Skills

A user story describes **what’s needed** in natural language, e.g. "Add a new function to the plugin that fetches the user’s balance." That maps to an **area**: plugin work → **plugin-wasm**.

- **In the PRD**: Set the story’s `skills` array to the **area** name(s) that match what’s needed, e.g. `"skills": ["plugin-wasm"]` or `["service-tables", "service-actions"]`. The loop loads those skill subdirs and injects their `SKILL.md` content. The agent then uses the story text to pick the right **subsection** inside the doc (e.g. "add function" → `### Skill: add-function` in plugin-wasm).
- **Fallback**: If you use `type` or `category` (e.g. `"type": "plugin"`), the script maps them to a default area (e.g. `plugin` → `plugin-wasm`). Prefer explicit `skills` when possible.
- **No match**: If no skill subdir matches, the script logs to **`ralph-work/missing-skills.log`** and injects `ai/skills/README.md` so the agent sees what areas exist and can self-select or ask for clarification.
- The AI can always read more skill dirs under `ai/skills/` during execution if needed.

---

## 6. Planned Area Skills for Psibase (Phase 3)

Stories refer to **area** names. Each area’s SKILL.md is structured with **action subsections** (e.g. ### Skill: add-table, ### Skill: add-field).

| Area skill | Description | Example actions (subsections in SKILL.md) |
|------------|-------------|-------------------------------------------|
| `service-tables` | Service storage: tables, fields, indexes | add-table, add-field, add-index, modify-table |
| `service-actions` | On-chain actions and calls | add-action, add-pre-action, call-other-service |
| `service-graphql` | GraphQL queries for a service | add-query, expose-table-via-graphql |
| `plugin-wasm` | Browser-side WASM plugin logic | add-function, wire-wit, call-supervisor |
| `plugin-dependencies` | Adding deps to a plugin (Cargo + WIT + code) | add-dependency |
| `ui-supervisor-integration` | UI talking to plugins via Supervisor | call-plugin, preload-plugins, handle-transactions |
| `build-system` | CMake/make, adding packages, build debugging | add-package, make-targets, debug-build |
| `wit-interfaces` | WIT for WASM components (world.wit, impl.wit) | define-interface, world-vs-impl, extend-wit |
| `service-testing` | Testing services (simulated chain, etc.) | write-service-test, run-tests |

When authoring a story, set `skills` to the **area(s)** that match: e.g. `"skills": ["plugin-wasm"]` or `["service-tables", "service-actions"]`. The agent uses the story text to pick the right action subsection inside each area doc.

---

## 7. References

- [snarktank/ralph skills](https://github.com/snarktank/ralph/tree/main/skills)
- [Cursor Rules](https://docs.cursor.com/context/rules)
- [AGENTS.md standard](https://agents.md/)
- [Geoff Huntley on specs (stdlib as knowledge)](https://ghuntley.com/stdlib/)
