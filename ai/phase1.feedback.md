-- 1. ralph.sh
SKILLS_DIR can be set, right? Should be SCRIPT_DIR should be /psibase/ai/skills, right?

-- 2. prompt.md
## Your Task
2. Does this need to be part of the prompt? It seems like this is handled at the ralph.sh level.
## Psibase-Specific Guidance
- **Services** -- these are WASM core binaries, not WASM components (`components` is a WASM domain term that refers to p2 binaries vs the original WASM core binaries, so this is an important wording difference. Plugins by contrast *are* actually WASM components.
- **UIs** - can be written in any framework; just to be super accurate, it is *our standard* to write TS/React apps. That standard also includes TailwindCSS, shadcn components, tanstack react-query and tanstack forms. We also share components between apps when that provides leverage.
- **Building**: yes, and... due to the WASM core vs components distinction, services are built with `cargo build` and plugins are built with `cargo-psibase build`, much more on this in the docs.
- A relevant gotcha is when adding new dependencies to plugins: they must be added in Cargo.toml, the .wit files, and then imports in the actual code file. Also notable quirk with psibase (to be documented wherever) is world.wit vs impl.wit, much more on that in the docs as well.

-- 3. ralph docs
I wonder if prompt.md is leveraging AGENTS.md the way it should? Perhaps Learnings are just entries in AGENTS.md instead of .md files in a separate subdir? Please propose a strategy / defend the current structure.
Are we compatible with the tools listed at the end of the ralph README? for instance Ralph TUI? Let's make it a priority to stay compatible with standards and existing tools where possible.

-- 4. AI skills
## 4. Composability Strategy
Must Composite skills be built solely from atomic skills? Or can they simply comprise other skills (whether atomic or composite)?

## 5. Skill Invocation STrategy
Perhaps is no relevant skill matches, we log potential needed/new skills somewhere? It could start off a simply a log of "missing" skills that a user could develop as needed.

## 6. Planned skills
If these are meant to be atomic skills, i think these are too broad, but as composite, skills they're fine *but* it seems they need verbs in their name? Pls advise against this if this is against best practices, but here's what I imagine:

| Skill | Description |
|-------|-------------|
| `add table to service` | Build new psibase service table |
| `add function to plugin` | Add new function to a browser-side WASM plugins |
| `add dependnecy to plugin` | Add needed dependency to a plugin |

Again, this is just how I picture it; if this is counter to prevailing trends / best practices, please advise.

5. Directory layout
Looks good.
