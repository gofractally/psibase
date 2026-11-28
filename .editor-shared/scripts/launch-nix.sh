#!/usr/bin/env -S direnv exec . bash
set -euo pipefail

# Launch a chain from ./result (see build-nix.sh)

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

usage() {
    cat <<EOF
Usage: $0 [port] [producer] [host_ip]

Launch a fresh psinode chain from the Nix build in \$PROJECT_ROOT/result.
Deletes the existing db at \$PROJECT_ROOT/db before starting.

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

if [ ! -x "$PROJECT_ROOT/result/bin/psinode" ]; then
    echo "Error: $PROJECT_ROOT/result not found; run build-nix.sh first"
    exit 1
fi

# The binaries find share/psibase from their resolved path, which for
# result/bin symlinks is one Nix layer without the packages. Run copies
# beside a share/psibase that points at result.
PREFIX="$PROJECT_ROOT/result-prefix"
mkdir -p "$PREFIX/bin" "$PREFIX/share"
for bin in psinode psibase; do
    cp --remove-destination "$(readlink -f "$PROJECT_ROOT/result/bin/$bin")" "$PREFIX/bin/$bin"
done
ln -sfn "$PROJECT_ROOT/result/share/psibase" "$PREFIX/share/psibase"
echo "Boot with: $PREFIX/bin/psibase boot -p $PRODUCER" >&2

rm -rf "$PROJECT_ROOT/db"
PSIBASE_ADMIN_IP=$HOST_IP exec "$PREFIX/bin/psinode" "$PROJECT_ROOT/db" -p "$PRODUCER" -l "$PORT"
