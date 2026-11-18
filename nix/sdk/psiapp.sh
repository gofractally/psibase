set -euo pipefail

HOST="${PSIBASE_DEVNET_HOST:-psibase.localhost}"
PORT="${PSIBASE_DEVNET_PORT:-8080}"
PRODUCER="${PSIBASE_DEVNET_PRODUCER:-myprod}"
ADMIN_IP="${PSIBASE_ADMIN_IP:-${HOST_IP:-127.0.0.1}}"
STATE_DIR="${PSIBASE_DEVNET_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/psibase-devnet}"

usage() {
  cat <<EOF
Usage: psiapp <command> …

Commands:
  chain up [port] [producer] [state-dir]   Start fresh chain, boot, print API URL
  chain down                               Stop the chain started by up
  chain status                             Show pid / API if running
  new <project-name>                       Scaffold app into ./packages

Environment (chain):
  PSIBASE_DEVNET_HOST / PORT / PRODUCER / DIR
  PSIBASE_ADMIN_IP / HOST_IP

API URL uses a hostname (not a bare IP) for virtual hosting.
EOF
}

api_url() { echo "http://${HOST}:${PORT}/"; }

wait_http() {
  local n code
  for n in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 1 \
      -H "Host: x-admin.${HOST}" "http://127.0.0.1:${PORT}/" 2>/dev/null || echo 000)
    if [[ "$code" =~ ^[0-9]+$ ]] && [[ "$code" != "000" ]]; then
      return 0
    fi
    sleep 0.25
  done
  echo "error: psinode did not accept HTTP on port ${PORT}" >&2
  return 1
}

chain_up() {
  PORT="${1:-$PORT}"
  PRODUCER="${2:-$PRODUCER}"
  STATE_DIR="${3:-$STATE_DIR}"
  mkdir -p "$STATE_DIR"
  local pidfile="$STATE_DIR/psinode.pid"
  local logfile="$STATE_DIR/psinode.log"
  local dbdir="$STATE_DIR/db"
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "error: psinode already running (pid $(cat "$pidfile")). Run: psiapp chain down" >&2
    exit 1
  fi
  rm -rf "$dbdir"
  mkdir -p "$dbdir"
  echo "Starting psinode (host=${HOST} port=${PORT} producer=${PRODUCER})"
  echo "  state: $STATE_DIR"
  PSIBASE_ADMIN_IP="$ADMIN_IP" \
    psinode "$dbdir" -p "$PRODUCER" -l "$PORT" --host "$HOST" \
    >"$logfile" 2>&1 &
  echo $! >"$pidfile"
  wait_http
  echo "Booting chain…"
  psibase boot -a "$(api_url)" -p "$PRODUCER"
  echo ""
  echo "Devnet ready."
  echo "  API:      $(api_url)"
  echo "  Admin:    http://x-admin.${HOST}:${PORT}/"
  echo "  Producer: ${PRODUCER}"
  echo "  Stop:     psiapp chain down"
  echo ""
  echo "  cargo-psibase install -a $(api_url)"
}

chain_down() {
  local pidfile="$STATE_DIR/psinode.pid"
  if [[ ! -f "$pidfile" ]]; then
    echo "No pid file at $pidfile (nothing to stop)."
    return 0
  fi
  local pid
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null || true
    echo "Stopped psinode (pid $pid)."
  else
    echo "Stale pid file (process $pid not running)."
  fi
  rm -f "$pidfile"
}

chain_status() {
  local pidfile="$STATE_DIR/psinode.pid"
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "running pid=$(cat "$pidfile") api=$(api_url) state=$STATE_DIR"
  else
    echo "stopped state=$STATE_DIR"
    return 1
  fi
}

cmd_chain() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    up) chain_up "$@" ;;
    down) chain_down "$@" ;;
    status) chain_status "$@" ;;
    -h|--help|help|"")
      cat <<EOF
Usage: psiapp chain <up|down|status> …

  up [port] [producer] [state-dir]   Start fresh chain, boot, print API URL
  down                               Stop the chain started by up
  status                             Show pid / API if running
EOF
      ;;
    *)
      echo "unknown chain subcommand: $sub" >&2
      echo "Try: psiapp chain --help" >&2
      exit 1
      ;;
  esac
}

find_packages_dir() {
  local d
  d="$(pwd)"
  while [[ "$d" != "/" ]]; do
    if [[ -f "$d/packages/Cargo.toml" ]]; then
      echo "$d/packages"
      return 0
    fi
    if [[ -f "$d/Cargo.toml" ]] && grep -q '^\[workspace\]' "$d/Cargo.toml" 2>/dev/null \
      && [[ "$(basename "$d")" == "packages" ]]; then
      echo "$d"
      return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

cmd_new() {
  local VERSION="${PSIBASE_CRATE_VERSION:-@psibaseCrateVersion@}"
  local TEMPLATES="${PSIBASE_PACKAGE_TEMPLATES:-}"
  if [[ -z "$TEMPLATES" || ! -d "$TEMPLATES" ]]; then
    echo "error: PSIBASE_PACKAGE_TEMPLATES not set (enter nix develop .#sdk)" >&2
    exit 1
  fi

  local PACKAGES_DIR
  PACKAGES_DIR="$(find_packages_dir)" || {
    echo "error: no packages/Cargo.toml found above $(pwd)" >&2
    echo "  Run from an SDK workspace (flake init -t …#package), or cd into it." >&2
    exit 1
  }

  local NAME="${1:-}"
  if [[ -z "$NAME" ]]; then
    echo "Usage: psiapp new <project-name>" >&2
    echo "  Creates packages/<AppName>/ (service, query-service, plugin, ui)" >&2
    exit 1
  fi
  shift || true

  # Flake copies live in the Nix store (mode 0444). cargo-generate copies
  # those modes into its work dir then fails with EACCES when rewriting files.
  local TEMPLATE_SRC="$TEMPLATES/sdk-basic-01"
  if [[ ! -d "$TEMPLATE_SRC" ]]; then
    echo "error: missing template at $TEMPLATE_SRC" >&2
    exit 1
  fi
  local WORK
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/psiapp-new.XXXXXX")"
  trap 'rm -rf "$WORK"' EXIT
  cp -a "$TEMPLATE_SRC" "$WORK/template"
  chmod -R u+w "$WORK/template"

  echo "Generating '$NAME' into $PACKAGES_DIR (psibase $VERSION)…"
  cargo generate \
    --path "$WORK/template" \
    --destination "$PACKAGES_DIR" \
    --init \
    -v \
    --allow-commands \
    --name "$NAME" \
    --define "version=$VERSION" \
    --define "description=${PSIBASE_NEW_DESCRIPTION:-An example application}" \
    "$@"

  # Hook scripts must remain available during generate; strip leftovers.
  rm -f "$PACKAGES_DIR"/*.rhai

  if [[ -d "$PACKAGES_DIR/.workspace-placeholder" ]]; then
    rm -rf "$PACKAGES_DIR/.workspace-placeholder"
    if grep -q '\.workspace-placeholder' "$PACKAGES_DIR/Cargo.toml"; then
      grep -v '\.workspace-placeholder' "$PACKAGES_DIR/Cargo.toml" >"$PACKAGES_DIR/Cargo.toml.tmp"
      mv "$PACKAGES_DIR/Cargo.toml.tmp" "$PACKAGES_DIR/Cargo.toml"
    fi
  fi

  local CAMEL
  CAMEL="$(echo "$NAME" | sed -E 's/(^|-)([a-z])/\U\2/g')"
  echo ""
  echo "Next:"
  echo "  cd $PACKAGES_DIR/$CAMEL/ui && yarn && yarn build"
  echo "  cd $PACKAGES_DIR/$CAMEL && cargo-psibase package"
}

cmd="${1:-}"
shift || true
case "$cmd" in
  chain) cmd_chain "$@" ;;
  new) cmd_new "$@" ;;
  -h|--help|help|"") usage ;;
  *)
    echo "unknown command: $cmd" >&2
    usage >&2
    exit 1
    ;;
esac
