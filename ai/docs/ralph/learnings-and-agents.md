# Learnings: AGENTS.md vs lessons-learned

## Strategy

**Recommendation: use both, with clear roles.**

| Where | Purpose | Who updates |
|-------|---------|-------------|
| **AGENTS.md** (repo-wide and per-directory) | Project-specific learnings: patterns, gotchas, and conventions that apply to *this codebase*. Cursor and other AI tools automatically read these. | Ralph (during loop) and humans |
| **ai/lessons-learned/** | Cross-run, reusable lessons: failures that got user fixes, and patterns that apply across projects or are worth turning into skills. Can feed back into `ai/skills/` or `ai/docs/psibase/`. | Human (after fixing an escalation); optionally Ralph on resume |

**Why both?**

- **AGENTS.md** is the standard place for “how to work in this repo.” Keeping learnings there means every future iteration (and every Cursor session) sees them without extra wiring. Ralph should update AGENTS.md when it discovers reusable patterns during a run.
- **lessons-learned/** is for outcomes that need a human decision: “was this a one-off fix or a pattern?” It also avoids bloating AGENTS.md with one-off escalation post-mortems. Entries here can be promoted to a skill or a doc in `ai/docs/psibase/` (e.g. gotchas).

So: **prompt.md should tell the agent to write learnings into AGENTS.md** (and to consolidate into the Codebase Patterns section at the top of `progress.txt` as we already do). The prompt should *also* say: when you don’t have time to refine a learning into AGENTS.md, or when it’s clearly cross-project, note it for the user to add to `ai/lessons-learned/` or a skill.

## Prompt.md leverage of AGENTS.md

- **Before starting**: “Read relevant AGENTS.md files for the areas you’re editing (see [AGENTS.md standard](https://agents.md/) and repo root/packages AGENTS.md).”
- **After discovering a pattern**: “If you discover a reusable pattern or gotcha, add it to the appropriate AGENTS.md (nearest to the edited code). Keep entries short and actionable.”
- **Escalation / resume**: “When the user fixes an escalation, the next run can summarize what changed and suggest an AGENTS.md or lessons-learned entry; the user can paste it.”

This keeps prompt.md aligned with the standard (AGENTS.md as the primary learning store for the repo) and uses lessons-learned for curation and skill-building.

## Summary

- **Primary**: Learnings go into **AGENTS.md** so they’re automatically in context for future runs and Cursor.
- **Secondary**: User-maintained **ai/lessons-learned/** (and optionally new skills) for escalation post-mortems and cross-project patterns.
- **Prompt**: Instruct Ralph to read and update AGENTS.md; mention lessons-learned for cross-project or user-curated content.
