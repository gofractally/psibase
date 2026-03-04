# Ralph for Psibase

How we're adapting the Ralph pattern for psibase development using cursor-agent.

## Adaptation Overview

We're adapting the Ralph pattern for psibase app development. Key differences from vanilla Ralph:

- **Tool**: cursor-agent (instead of claude-code or amp)
- **Domain**: psibase blockchain app development (services, plugins, UIs)
- **Skills system**: Granular, composable AI skills for psibase-specific tasks
- **3-attempt retry limit**: Per subtask, with escalation reports when exceeded
- **Model routing**: Expensive model for planning/hard tasks, cheap model for routine execution
- **Git branch enforcement**: PRD specifies branch; loop verifies before executing
- **Self-learning**: Failed tasks that get user fixes → lessons learned → skill updates

## cursor-agent Integration

### Invocation

```bash
cursor-agent -p --trust --force --workspace /path/to/psibase "$(cat prompt.md)"
```

### Flags

| Flag | Purpose |
|------|---------|
| `--print` (`-p`) | Non-interactive output mode |
| `--trust` | Trust workspace without prompting (headless mode) |
| `--force` | Auto-approve commands |
| `--workspace` | Set workspace directory |
| `--model` | Select model (configurable in `ralph.conf`) |
| `--output-format stream-json` | For structured output parsing |

## Psibase-Specific Adaptations

```mermaid
flowchart TD
    A[Start iteration] --> B{Verify git branch matches PRD}
    B -->|Mismatch| C[Stop: branch safety]
    B -->|Match| D[Read task from prd.json]
    D --> E[Inject relevant skills into prompt]
    E --> F[Execute: Task at hand [attempt #N]]
    F --> G{Quality checks pass?}
    G -->|Yes| H[Commit & update progress]
    H --> I{More tasks?}
    I -->|Yes| A
    I -->|No| J[Output COMPLETE]
    G -->|No| K{Attempt < 3?}
    K -->|Yes| F
    K -->|No| L[Write escalation report]
    L --> M[Exit]
```

1. **Task scoping**: Narrowly scoped tasks with attempt counter: `Task at hand [attempt #N]: <specific task>`
2. **3-strike escalation**: If same task fails 3 times → write escalation report → exit
3. **Skill injection**: Based on current task type, inject relevant skill docs into prompt context
4. **Build verification via make**: Use `make <package>` commands rather than raw cargo
5. **Self-learning on resume**: After user fixes a failed task, diff changes, create lesson learned entry, potentially create new skill
6. **Branch safety**: Verify git branch matches PRD before each iteration

## Key Files

All paths relative to the psibase repo root:

| File/Directory | Purpose |
|----------------|---------|
| `ai/ralph-work/ralph.sh` | Main loop script |
| `ai/ralph-work/ralph.conf` | Configuration (max iterations, stories per run, model, branch) |
| `ai/ralph-work/prompt.md` | Prompt template given to each cursor-agent iteration |
| `ai/ralph-work/projects/` | Where user PRDs and `prd.json` live |
| `ai/ralph-work/reports/` | Escalation reports when tasks fail 3 times |
| `ai/ralph-work/templates/` | Templates for PRDs and user stories |
| `ai/lessons-learned/` | Self-learning entries from user interventions |
| `ai/skills/` | Composable AI skills for psibase development |
| `ai/docs/psibase/` | Psibase knowledge base for AI context |

## Comparison with Vanilla Ralph

| Aspect | Vanilla Ralph | Psibase Ralph |
|--------|---------------|---------------|
| Tool | claude-code / amp | cursor-agent |
| Task source | prd.json | prd.json (same format) |
| Quality checks | typecheck, lint, test | make build, service tests, deploy check |
| Self-improvement | AGENTS.md updates | lessons-learned/ + skill updates |
| Failure handling | Continues next iteration | 3-strike escalation with report |
| Context injection | Specs only | Specs + relevant skills + psibase docs |
| Model selection | Single model | Configurable per-task routing |
| Branch management | Auto-creates from PRD | Verifies branch matches PRD, stops if mismatch |
