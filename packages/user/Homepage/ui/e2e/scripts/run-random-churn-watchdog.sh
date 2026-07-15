#!/usr/bin/env bash
# Run random-churn e2e with wall-clock cap + log-staleness watchdog.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

RUNS="${PSIBASE_E2E_RANDOM_CHURN_RUNS:-2}"
WALL_SEC="${PSIBASE_E2E_RANDOM_CHURN_TIMEOUT_SEC:-600}"
STALL_SEC="${PSIBASE_E2E_RANDOM_CHURN_STALL_SEC:-120}"
FAIL_IDLE_SEC="${PSIBASE_E2E_RANDOM_CHURN_FAIL_IDLE_SEC:-60}"
POLL_SEC="${PSIBASE_E2E_RANDOM_CHURN_POLL_SEC:-20}"
LOG="${PSIBASE_E2E_RANDOM_CHURN_LOG:-/tmp/random-churn-e2e.log}"
GRACE_SEC="${PSIBASE_E2E_RANDOM_CHURN_GRACE_SEC:-90}"

count_churn_steps() {
  grep -E '^\[random-churn\] iter=[0-9]+ .* end \(\+' "$LOG" 2>/dev/null | wc -l | tr -d ' '
}

has_step_failure() {
  grep -qE 'STEP TIMEOUT|iter=[0-9]+ step=[0-9]+ kind=.* FAIL' "$LOG" 2>/dev/null
}

echo "[watchdog] runs=$RUNS wall_sec=$WALL_SEC stall_sec=$STALL_SEC fail_idle_sec=$FAIL_IDLE_SEC log=$LOG"

if ss -tlnp 2>/dev/null | grep -q ':8080'; then
  echo "[watchdog] clearing stale listener on :8080"
  pkill -9 psinode 2>/dev/null || true
  sleep 2
fi

: >"$LOG"

# Hard wall clock via timeout(1); bash -c keeps a single trackable pid.
timeout --kill-after=10 "$WALL_SEC" bash -c "
  export PSIBASE_E2E_RANDOM_CHURN_RUNS=\"$RUNS\"
  export PSIBASE_E2E_RANDOM_CHURN_STEP_MS=\"${PSIBASE_E2E_RANDOM_CHURN_STEP_MS:-90000}\"
  export PSIBASE_E2E_RANDOM_CHURN_MESH_MS=\"${PSIBASE_E2E_RANDOM_CHURN_MESH_MS:-120000}\"
  cd \"$ROOT\"
  exec yarn e2e:random-churn >>\"$LOG\" 2>&1
" &
PW_PID=$!

cleanup() {
  if kill -0 "$PW_PID" 2>/dev/null; then
    echo "[watchdog] killing pid $PW_PID and playwright children"
    kill -TERM "$PW_PID" 2>/dev/null || true
    sleep 2
    kill -KILL "$PW_PID" 2>/dev/null || true
  fi
  pkill -f "chat-group-three-party-random" 2>/dev/null || true
  pkill -f "workerProcessEntry" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

LAST_STEPS=0
STARTED_AT=$(date +%s)
STOP_REASON=""

waited=0
while kill -0 "$PW_PID" 2>/dev/null; do
  sleep "$POLL_SEC"
  waited=$((waited + POLL_SEC))
  if [[ ! -f "$LOG" ]] || [[ "$(wc -l <"$LOG" | tr -d ' ')" -lt 3 ]]; then
    if [[ "$waited" -ge "$GRACE_SEC" ]] && ! kill -0 "$PW_PID" 2>/dev/null; then
      STOP_REASON="child-exited-early"
      break
    fi
    continue
  fi
  AGE=$(( $(date +%s) - $(stat -c %Y "$LOG") ))
  STEPS=$(count_churn_steps)
  TAIL=$(grep -E '^\[random-churn\] iter=' "$LOG" 2>/dev/null | tail -1 || true)
  echo "[watchdog] log_age=${AGE}s steps=$STEPS last=${TAIL:-none}"

  if grep -qE '^\s+[0-9]+ passed' "$LOG" 2>/dev/null; then
    STOP_REASON="passed"
    break
  fi
  if grep -qE '^\s+[0-9]+ failed' "$LOG" 2>/dev/null; then
    STOP_REASON="playwright-failed"
    break
  fi
  if has_step_failure && [[ "$AGE" -ge "$FAIL_IDLE_SEC" ]]; then
    STOP_REASON="step-fail-idle-${AGE}s"
    break
  fi

  if [[ "$STEPS" -gt "$LAST_STEPS" ]]; then
    LAST_STEPS=$STEPS
    continue
  fi
  ELAPSED=$(( $(date +%s) - STARTED_AT ))
  if [[ "$ELAPSED" -lt "$GRACE_SEC" ]]; then
    continue
  fi
  if [[ "$AGE" -ge "$STALL_SEC" ]]; then
    STOP_REASON="stall-${AGE}s"
    echo "[watchdog] STALL: no completed steps for ${AGE}s (threshold ${STALL_SEC}s)"
    tail -40 "$LOG"
    break
  fi
done

if [[ -z "$STOP_REASON" ]] && ! kill -0 "$PW_PID" 2>/dev/null; then
  STOP_REASON="child-exited"
fi

cleanup
wait "$PW_PID" 2>/dev/null || true

if [[ "$STOP_REASON" == "passed" ]] || grep -qE '^\s+1 passed' "$LOG" 2>/dev/null; then
  echo "[watchdog] done: passed (steps=$LAST_STEPS reason=${STOP_REASON:-wait})"
  exit 0
fi
echo "[watchdog] done: failed (steps=$LAST_STEPS reason=${STOP_REASON:-unknown})"
exit 1
