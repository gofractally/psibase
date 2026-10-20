#!/usr/bin/env -S direnv exec . bash
set -euo pipefail

# Continue/resume a chain
# Same as launch but doesn't first delete the db.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

usage() {
    cat <<EOF
Usage: $0 [port] [producer] [host_ip]

Resume an existing psinode chain using the db at \$PROJECT_ROOT/db.
Same as launch, but does not delete the db first.

Arguments:
  port       Port to listen on (default: 8080)
  producer   Producer name (default: myprod)
  host_ip    Admin IP for PSIBASE_ADMIN_IP (default: \$HOST_IP env var)

Options:
  -h, --help  Show this help and exit
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

PORT="${1:-8080}"
PRODUCER="${2:-myprod}"
HOST_IP="${3:-${HOST_IP:-}}"

if [ -z "$HOST_IP" ]; then
    echo "Error: HOST_IP not set"
    usage
    exit 1
fi

PSIBASE_ADMIN_IP=$HOST_IP exec psinode "$PROJECT_ROOT/db" -p "$PRODUCER" -l "$PORT"
