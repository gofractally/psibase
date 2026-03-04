# Ralph System Verification (Phase 5)

Use this checklist to verify the AI coding workflow is correctly integrated and ready to use.

---

## Prerequisites

| Check | How to verify |
|-------|----------------|
| **jq** | `jq --version` |
| **cursor-agent** | `cursor-agent --version` (or ensure it’s on PATH) |
| **Git** | `git -C <WORKSPACE> status` — workspace is a git repo |
| **Workspace** | `ralph.conf` has correct `WORKSPACE` path to psibase repo |
| **Skills** | `ls "$WORKSPACE/ai/skills"` shows area dirs (e.g. service-tables, plugin-wasm) |
| **Knowledge base** | `ls "$WORKSPACE/ai/docs/psibase"` shows *.md (architecture, rust-services, etc.) |

---

## Dry run (no cursor-agent)

1. **Sample PRD**  
   Copy the sample so the script can find a valid prd.json:
   ```bash
   cp templates/prd.sample.json prd.json
   ```
2. **Run dry-run**  
   ```bash
   ./ralph.sh --dry-run
   ```
   (Branch is not checked in dry-run, so you can run from any branch.)
4. **Check output**  
   - Script exits 0 and says "Dry run: prompt built and written to last_run/dry_run_prompt.md".
   - Open `last_run/dry_run_prompt.md`: it should contain the full prompt with:
     - PRD JSON in place of `{{PRD_JSON}}`
     - Progress (empty or existing progress.txt) in place of `{{PROGRESS_TXT}}`
     - Skill content (e.g. from `service-actions/SKILL.md`) in place of `{{SKILL_CONTENT}}`

If any of these are missing, fix config or paths (e.g. `WORKSPACE`, `SKILLS_DIR`) and re-run.

---

## One-iteration run (optional)

To confirm the full loop (including cursor-agent) with minimal work:

1. Use a real PRD (or the sample) with `branchName` matching your current branch.
2. Run:
   ```bash
   ./ralph.sh
   ```
3. Let one iteration complete. Check:
   - stdout shows iteration 1, model, and task.
   - `iteration.log` has one line (model, iteration, story_id, story_title, result).
   - Either the agent outputs COMPLETE (then prd.json story is marked `passes: true`) or you see escalation / no_complete.

You can stop after one iteration (Ctrl+C) or let the loop hit max iterations or escalation.

---

## Integration checklist (delivered)

- [x] **Phase 1:** Ralph research, skills strategy, scaffolding, ralph.sh, ralph.conf, prompt.md, templates
- [x] **Phase 2:** Psibase knowledge base (`ai/docs/psibase/*.md`)
- [x] **Phase 3:** Area skills (`ai/skills/*/SKILL.md`)
- [x] **Phase 4:** Loop infrastructure (prd.json update on COMPLETE, consecutive-failure escalation, iteration.log)
- [x] **Phase 5:** Verification (dry-run, sample PRD, this guide)

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| Dry-run fails "prd.json not found" | Copy `templates/prd.sample.json` to `prd.json` in the same dir as `ralph.sh`. |
| Dry-run fails "branch mismatch" | Dry-run skips branch check; this only applies to a real run. Set `branchName` in `prd.json` to your current branch. |
| Prompt has empty `{{PRD_JSON}}` | prd.json is invalid or unreadable; run `jq . prd.json` to check. |
| Prompt has empty skill content | Story has no `skills` and no `type`/`category` that maps in SKILL_TYPE_MAP, or SKILLS_DIR is wrong. Check `missing-skills.log` if present. |
| cursor-agent not found | Install Cursor CLI and ensure `cursor-agent` is on PATH. |
