#!/usr/bin/env -S direnv exec . bash
set -euo pipefail

# Launch a chain

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

HOST_IP=$1
PRODUCER=$2
PORT=$3

if [ -z "$HOST_IP" ] || [ -z "$PRODUCER" ] || [ -z "$PORT" ]; then
    echo "Error: Missing required parameters"
    echo "Usage: $0 <host_ip> <producer> <port>"
    exit 1
fi


rm -rf "$PROJECT_ROOT/db"
PSIBASE_ADMIN_IP=$HOST_IP psinode "$PROJECT_ROOT/db" -p "$PRODUCER" -l "$PORT"
