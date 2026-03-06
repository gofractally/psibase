#!/usr/bin/env bash
# Ralph-inspired autonomous AI coding loop for psibase development using cursor-agent.
# Usage: ./ralph.sh [--help]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/ralph.conf"
PRD_FILE="${SCRIPT_DIR}/prd.json"
PROGRESS_FILE="${SCRIPT_DIR}/progress.txt"
PROMPT_FILE="${SCRIPT_DIR}/prompt.md"
STATE_FILE="${SCRIPT_DIR}/state.json"
LAST_RUN_DIR="${SCRIPT_DIR}/last_run"
ARCHIVE_DIR="${SCRIPT_DIR}/archive"
REPORTS_DIR="${SCRIPT_DIR}/reports"
ITERATION_LOG="${SCRIPT_DIR}/iteration.log"
SKILLS_DIR=""

# Config defaults (overridden by ralph.conf)
MAX_ITERATIONS=10
STORIES_PER_RUN=1
MODEL=auto
MAX_TASK_ATTEMPTS=3
WORKSPACE=/home/mike/repos/fractally/psibase
BUILD_DIR=build

# -----------------------------------------------------------------------------
# Help
# -----------------------------------------------------------------------------
show_help() {
    cat << 'EOF'
Ralph - Autonomous AI coding loop for psibase development

Usage: ralph.sh [--help] [--dry-run]

Runs cursor-agent in a loop, processing user stories from prd.json until:
  - All stories pass (outputs <promise>COMPLETE</promise>)
  - Max iterations reached
  - Escalation (task fails MAX_TASK_ATTEMPTS times)

Prerequisites:
  - prd.json in same directory (must contain branchName matching current git branch)
  - prompt.md template
  - cursor-agent on PATH

Configuration: Edit ralph.conf in the same directory.
  MAX_ITERATIONS    Max loop iterations per run
  STORIES_PER_RUN   Stories to complete before stopping
  MODEL             Model for cursor-agent (auto, sonnet-4, opus-4.5, etc.)
  MAX_TASK_ATTEMPTS Retries per subtask before escalation
  WORKSPACE         Psibase repo root
  BUILD_DIR         Build directory relative to workspace
  SKILLS_DIR        Skills directory (default: WORKSPACE/ai/skills)

Output:
  - Iteration log: iteration.log (model, iteration, story, result per run)
  - Escalation reports: reports/escalation-YYYY-MM-DD-HHMMSS.md
  - State: state.json
  - Archives: archive/YYYY-MM-DD-feature-name/ (on branch switch)

With --dry-run: builds the prompt (config, branch, skills injection) and writes it to
  last_run/dry_run_prompt.md without calling cursor-agent. Use to verify setup.
EOF
}

# -----------------------------------------------------------------------------
# Config parsing
# -----------------------------------------------------------------------------
load_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        echo "Warning: $CONFIG_FILE not found, using defaults"
        return
    fi
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%%#*}"
        line="${line#"${line%%[![:space:]]*}"}"
        line="${line%"${line##*[![:space:]]}"}"
        [[ -z "$line" || "$line" != *=* ]] && continue
        key="${line%%=*}"
        key="${key%"${key##*[![:space:]]}"}"
        val="${line#*=}"
        val="${val#"${val%%[![:space:]]*}"}"
        case "$key" in
            MAX_ITERATIONS) MAX_ITERATIONS="$val" ;;
            STORIES_PER_RUN) STORIES_PER_RUN="$val" ;;
            MODEL) MODEL="$val" ;;
            MAX_TASK_ATTEMPTS) MAX_TASK_ATTEMPTS="$val" ;;
            WORKSPACE) WORKSPACE="$val" ;;
            BUILD_DIR) BUILD_DIR="$val" ;;
            SKILLS_DIR) SKILLS_DIR="$val" ;;
        esac
    done < "$CONFIG_FILE"
    # Default SKILLS_DIR to workspace-relative path if not set
    if [[ -z "$SKILLS_DIR" ]]; then
        SKILLS_DIR="${WORKSPACE}/ai/skills"
    fi
}

# -----------------------------------------------------------------------------
# Git branch verification
# -----------------------------------------------------------------------------
verify_branch() {
    local branch_name
    if ! command -v jq &>/dev/null; then
        echo "Error: jq is required for parsing prd.json"
        exit 1
    fi
    if ! branch_name=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null); then
        echo "Error: Failed to parse branchName from $PRD_FILE"
        exit 1
    fi
    if [[ -z "$branch_name" ]]; then
        echo "Error: prd.json must contain branchName"
        exit 1
    fi
    local current_branch
    current_branch=$(git -C "$WORKSPACE" rev-parse --abbrev-ref HEAD 2>/dev/null) || true
    if [[ -z "$current_branch" ]]; then
        echo "Error: Not a git repository or cannot determine current branch"
        exit 1
    fi
    if [[ "$current_branch" != "$branch_name" ]]; then
        echo "Error: Git branch mismatch. Current: $current_branch, PRD expects: $branch_name"
        echo "Switch to the correct branch before running. (Do not auto-switch.)"
        exit 1
    fi
}

# -----------------------------------------------------------------------------
# Archive previous runs on branch switch
# -----------------------------------------------------------------------------
archive_if_branch_switch() {
    local new_branch="$1"
    local last_branch=""
    if [[ -f "$STATE_FILE" ]]; then
        last_branch=$(jq -r '.last_branch // empty' "$STATE_FILE" 2>/dev/null) || true
    fi
    if [[ -n "$last_branch" && "$last_branch" != "$new_branch" && -d "$LAST_RUN_DIR" ]]; then
        local date_part
        date_part=$(date +%Y-%m-%d)
        local safe_name
        safe_name=$(echo "$last_branch" | tr '/' '-' | tr -cd '[:alnum:]-_')
        local archive_path="${ARCHIVE_DIR}/${date_part}-${safe_name}"
        mkdir -p "$archive_path"
        [[ -f "$LAST_RUN_DIR/prd.json" ]] && cp "$LAST_RUN_DIR/prd.json" "$archive_path/"
        [[ -f "$LAST_RUN_DIR/progress.txt" ]] && cp "$LAST_RUN_DIR/progress.txt" "$archive_path/"
        echo "Archived previous run to $archive_path"
    fi
}

# -----------------------------------------------------------------------------
# Build prompt with injected content
# -----------------------------------------------------------------------------
# Map story type/category to area-based skill subdir names (for when "skills" array is absent)
SKILL_TYPE_MAP="service:service-tables plugin:plugin-wasm ui:ui-supervisor-integration query:service-graphql build:build-system test:service-testing wit:wit-interfaces config:build-system integration:chain-launch chain:chain-launch"

build_prompt() {
    local prd_content progress_content skill_content
    prd_content=$(cat "$PRD_FILE" 2>/dev/null || echo "{}")
    progress_content=$(cat "$PROGRESS_FILE" 2>/dev/null || echo "")
    skill_content=""
    local missing_skills_log="${SCRIPT_DIR}/missing-skills.log"
    if [[ -d "$SKILLS_DIR" ]]; then
        # Support both snarktank (userStories) and our (stories) PRD shape; use first incomplete story
        local first_story
        first_story=$(jq -c '(.userStories // .stories // []) | map(select(.passes != true)) | .[0] // empty' "$PRD_FILE" 2>/dev/null) || true
        local skill_dirs=()
        if [[ -n "$first_story" ]]; then
            # Explicit skills array takes precedence
            local skills_json
            skills_json=$(jq -r '.skills[]? // empty' <<< "$first_story" 2>/dev/null) || true
            if [[ -n "$skills_json" ]]; then
                while IFS= read -r s; do
                    [[ -n "$s" && -d "$SKILLS_DIR/$s" ]] && skill_dirs+=("$s")
                done <<< "$skills_json"
            fi
            # Else derive from type/category
            if [[ ${#skill_dirs[@]} -eq 0 ]]; then
                local task_type
                task_type=$(jq -r '.type // .category // empty' <<< "$first_story" 2>/dev/null) || true
                if [[ -n "$task_type" ]]; then
                    local mapped
                    mapped=$(echo "$SKILL_TYPE_MAP" | tr ' ' '\n' | awk -v t="$task_type" -F: '$1==t {print $2}')
                    if [[ -n "$mapped" && -d "$SKILLS_DIR/$mapped" ]]; then
                        skill_dirs+=("$mapped")
                    fi
                fi
            fi
        fi
        for subdir in "${skill_dirs[@]}"; do
            local skill_file="$SKILLS_DIR/$subdir/SKILL.md"
            [[ -f "$skill_file" ]] && skill_content+=$'\n'"--- $skill_file ---"$'\n'"$(cat "$skill_file" 2>/dev/null)"$'\n'
        done
        if [[ -z "$skill_content" ]]; then
            if [[ -n "$first_story" ]]; then
                local story_id story_title
                story_id=$(jq -r '.id // "unknown"' <<< "$first_story" 2>/dev/null)
                story_title=$(jq -r '.title // "unknown"' <<< "$first_story" 2>/dev/null)
                echo "$(date -Iseconds) story=$story_id title=$story_title (type/category/skills not matched to any skill subdir in $SKILLS_DIR)" >> "$missing_skills_log"
            fi
            # Fallback: include top-level README so agent knows what skills exist
            [[ -f "$SKILLS_DIR/README.md" ]] && skill_content=$'\n'"--- $SKILLS_DIR/README.md ---"$'\n'"$(cat "$SKILLS_DIR/README.md" 2>/dev/null)"$'\n'
        fi
    fi
    local prompt
    if [[ ! -f "$PROMPT_FILE" ]]; then
        echo "Error: prompt.md not found at $PROMPT_FILE"
        exit 1
    fi
    prompt=$(cat "$PROMPT_FILE")
    prompt="${prompt//\{\{PRD_JSON\}\}/$prd_content}"
    prompt="${prompt//\{\{PROGRESS_TXT\}\}/$progress_content}"
    prompt="${prompt//\{\{SKILL_CONTENT\}\}/$skill_content}"
    echo "$prompt"
}

# -----------------------------------------------------------------------------
# Write escalation report
# -----------------------------------------------------------------------------
write_escalation_report() {
    local escalation_content="$1"
    local attempts="$2"
    local timestamp
    timestamp=$(date +%Y-%m-%d-%H%M%S)
    local report_path="${REPORTS_DIR}/escalation-${timestamp}.md"
    mkdir -p "$REPORTS_DIR"
    {
        echo "# Escalation Report"
        echo "Date: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "Task: $(echo "$escalation_content" | head -1)"
        echo "Attempts: $attempts"
        echo ""
        echo "## Escalation Details"
        echo "$escalation_content"
        echo ""
        echo "## Suggested Action"
        echo "Review the escalation details above and address the blocking issue before resuming."
    } > "$report_path"
    echo "Escalation report written to $report_path"
}

# -----------------------------------------------------------------------------
# Mark first incomplete story as passed in prd.json
# -----------------------------------------------------------------------------
mark_current_story_complete() {
    local stories_key
    stories_key=$(jq -r 'if .userStories != null then "userStories" else "stories" end' "$PRD_FILE" 2>/dev/null) || true
    [[ -z "$stories_key" ]] && return 1
    local idx
    idx=$(jq -r --arg k "$stories_key" '
        (.[$k] | to_entries | map(select(.value.passes != true)) | .[0].key) // empty
    ' "$PRD_FILE" 2>/dev/null) || true
    if [[ -z "$idx" ]]; then
        return 0
    fi
    local tmp
    tmp=$(mktemp)
    jq --argjson idx "$idx" --arg k "$stories_key" '.[$k][$idx].passes = true' "$PRD_FILE" > "$tmp" && mv "$tmp" "$PRD_FILE"
}

# -----------------------------------------------------------------------------
# Update state.json
# -----------------------------------------------------------------------------
update_state() {
    local iteration="$1"
    local stories_completed="${2:-0}"
    local last_story_id="${3:-}"
    local last_branch="${4:-}"
    local started_at
    started_at=$(jq -r '.started_at // empty' "$STATE_FILE" 2>/dev/null) || true
    [[ -z "$started_at" ]] && started_at=$(date -Iseconds)
    local branch
    branch=$(jq -r '.branchName' "$PRD_FILE" 2>/dev/null)
    jq -n \
        --arg iter "$iteration" \
        --arg stories "$stories_completed" \
        --arg last_story "$last_story_id" \
        --arg started "$started_at" \
        --arg updated "$(date -Iseconds)" \
        --arg branch "${last_branch:-$branch}" \
        '{
            current_iteration: ($iter | tonumber),
            stories_completed: ($stories | tonumber),
            last_story_id: $last_story,
            started_at: $started,
            last_iteration_at: $updated,
            last_branch: $branch
        }' > "$STATE_FILE"
}

# -----------------------------------------------------------------------------
# Append one line to iteration log
# -----------------------------------------------------------------------------
log_iteration() {
    local result="$1"
    local story_id="${2:-}"
    local story_title="${3:-}"
    echo "$(date -Iseconds) | model=$MODEL | iteration=$iteration | story_id=$story_id | story_title=$story_title | result=$result" >> "$ITERATION_LOG"
}

# -----------------------------------------------------------------------------
# Save last run for archiving
# -----------------------------------------------------------------------------
save_last_run() {
    mkdir -p "$LAST_RUN_DIR"
    [[ -f "$PRD_FILE" ]] && cp "$PRD_FILE" "$LAST_RUN_DIR/"
    [[ -f "$PROGRESS_FILE" ]] && cp "$PROGRESS_FILE" "$LAST_RUN_DIR/"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
        show_help
        exit 0
    fi

    load_config

    if [[ ! -f "$PRD_FILE" ]]; then
        echo "Error: prd.json not found at $PRD_FILE"
        exit 1
    fi

    if [[ "${1:-}" == "--dry-run" ]]; then
        mkdir -p "$LAST_RUN_DIR"
        local dry_out="${LAST_RUN_DIR}/dry_run_prompt.md"
        build_prompt > "$dry_out"
        echo "Dry run: prompt built and written to $dry_out"
        echo "  (branch check skipped; no cursor-agent invocation). Verify file contents and re-run without --dry-run to start the loop."
        exit 0
    fi

    verify_branch

    local branch_name
    branch_name=$(jq -r '.branchName' "$PRD_FILE")
    archive_if_branch_switch "$branch_name"
    local safe_branch
    safe_branch=$(echo "$branch_name" | tr '/' '-' | tr -cd '[:alnum:]-_')
    [[ -z "$safe_branch" ]] && safe_branch="branch"

    mkdir -p "$REPORTS_DIR" "$ARCHIVE_DIR" "$LAST_RUN_DIR"
    local run_log="${LAST_RUN_DIR}/run.log"
    exec > >(tee "$run_log") 2>&1
    echo "Logging to $run_log — to monitor progress in another terminal, run: tail -f $run_log"
    echo "Each iteration's agent output is written to ${LAST_RUN_DIR}/${safe_branch}-iteration-<N>.log — tail -f that file to see what the agent is doing."

    local iteration=0
    local stories_completed
    stories_completed=$(jq -r '.stories_completed // 0' "$STATE_FILE" 2>/dev/null) || echo "0"
    local last_story_id
    last_story_id=$(jq -r '.last_story_id // empty' "$STATE_FILE" 2>/dev/null) || true
    local consecutive_failures=0

    while [[ $iteration -lt $MAX_ITERATIONS ]]; do
        iteration=$((iteration + 1))

        local first_story_id first_story_title first_story_ac_count
        first_story_id=$(jq -r '(.userStories // .stories // []) | map(select(.passes != true)) | .[0].id // empty' "$PRD_FILE" 2>/dev/null) || true
        first_story_title=$(jq -r '(.userStories // .stories // []) | map(select(.passes != true)) | .[0].title // "current story"' "$PRD_FILE" 2>/dev/null) || true
        first_story_ac_count=$(jq -r '(.userStories // .stories // []) | map(select(.passes != true)) | .[0].acceptance_criteria | length // 0' "$PRD_FILE" 2>/dev/null) || true
        [[ -z "$first_story_title" ]] && first_story_title="current story"

        echo "[Model: $MODEL] Iteration $iteration of $MAX_ITERATIONS"
        if [[ -n "$first_story_id" ]]; then
            echo "  Task: $first_story_id - $first_story_title (acceptance criteria: $first_story_ac_count)"
        else
            echo "  Task: $first_story_title (acceptance criteria: $first_story_ac_count)"
        fi

        local prompt
        prompt=$(build_prompt)
        local tmp_prompt
        tmp_prompt=$(mktemp)
        printf '%s' "$prompt" > "$tmp_prompt"
        local agent_log="${LAST_RUN_DIR}/${safe_branch}-iteration-${iteration}.log"
        echo "  Agent output: tail -f $agent_log"
        local output
        output=$(cursor-agent -p --trust --force --workspace "$WORKSPACE" --model "$MODEL" "$(cat "$tmp_prompt")" 2>&1 | tee "$agent_log") || true
        rm -f "$tmp_prompt"

        if echo "$output" | grep -q '<promise>COMPLETE</promise>'; then
            mark_current_story_complete
            last_story_id="$first_story_id"
            stories_completed=$((stories_completed + 1))
            consecutive_failures=0
            log_iteration "complete" "$first_story_id" "$first_story_title"
            echo "Success: Story complete ($stories_completed of $STORIES_PER_RUN)."
            save_last_run
            update_state "$iteration" "$stories_completed" "$last_story_id" "$branch_name"
            if [[ $stories_completed -ge $STORIES_PER_RUN ]]; then
                echo "Stories per run ($STORIES_PER_RUN) reached. Stopping."
                exit 0
            fi
            update_state "$iteration" "$stories_completed" "$last_story_id" "$branch_name"
            sleep 2
            continue
        fi

        local escalation_content
        escalation_content=$(echo "$output" | sed -n '/<escalation>/,/<\/escalation>/p' | sed '1d;$d' || true)
        if [[ -n "$escalation_content" ]]; then
            log_iteration "escalation" "$first_story_id" "$first_story_title"
            write_escalation_report "$escalation_content" "$MAX_TASK_ATTEMPTS"
            save_last_run
            update_state "$iteration" "$stories_completed" "$last_story_id" "$branch_name"
            exit 1
        fi

        consecutive_failures=$((consecutive_failures + 1))
        log_iteration "no_complete" "$first_story_id" "$first_story_title"

        if [[ $consecutive_failures -ge $MAX_TASK_ATTEMPTS ]]; then
            local auto_escalation
            auto_escalation="Three consecutive iterations ($consecutive_failures) completed without story completion.

Last task: $first_story_title (id: $first_story_id)

The agent did not output <promise>COMPLETE</promise> or <escalation>. Consider reviewing progress.txt and the last agent output, then fix blocking issues and re-run ralph.sh."
            write_escalation_report "$auto_escalation" "$consecutive_failures"
            save_last_run
            update_state "$iteration" "$stories_completed" "$last_story_id" "$branch_name"
            echo "Escalation: $MAX_TASK_ATTEMPTS attempts without completion. Report written."
            exit 1
        fi

        update_state "$iteration" "$stories_completed" "$last_story_id" "$branch_name"
        sleep 2
    done

    echo "Max iterations ($MAX_ITERATIONS) reached."
    save_last_run
    update_state "$iteration" "$stories_completed" "$last_story_id" "$branch_name"
    exit 0
}

main "$@"
