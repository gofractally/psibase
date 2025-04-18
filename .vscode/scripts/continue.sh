#!/bin/bash

# Continue/resume a chain
# Same as launch but doesn't first delete the db.

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

psinode "$PROJECT_ROOT/db" -p "$PRODUCER" --admin-authz=rw:ip:"$HOST_IP" -l "$PORT" 