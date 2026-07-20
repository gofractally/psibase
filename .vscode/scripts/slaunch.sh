#!/usr/bin/env -S direnv exec . bash
set -euo pipefail

# Launch a secure chain

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

usage() {
    cat <<EOF
Usage: $0 [port] [producer] [host_ip] [pkcs11-module]

Launch a fresh psinode chain with PKCS#11-based signing. Deletes the
existing db at \$PROJECT_ROOT/db before starting.

Arguments:
  port           Port to listen on (default: 8080)
  producer       Producer name (default: myprod)
  host_ip        Admin IP for PSIBASE_ADMIN_IP (default: \$HOST_IP env var)
  pkcs11-module  Path to the PKCS#11 module
                 (default: /usr/lib/softhsm/libsofthsm2.so)

Options:
  -h, --help     Show this help and exit
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

PORT="${1:-8080}"
PRODUCER="${2:-myprod}"
HOST_IP="${3:-${HOST_IP:-}}"
PKCS11_MODULE="${4:-/usr/lib/softhsm/libsofthsm2.so}"

if [ -z "$HOST_IP" ]; then
    echo "Error: HOST_IP not set"
    usage
    exit 1
fi

rm -rf "$PROJECT_ROOT/db"
PSIBASE_ADMIN_IP=$HOST_IP exec psinode "$PROJECT_ROOT/db" -p "$PRODUCER" -l "$PORT" --pkcs11-module="$PKCS11_MODULE"
