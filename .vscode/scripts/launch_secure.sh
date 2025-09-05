#!/bin/bash

# Launch a secure chain

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

HOST_IP=$1
PRODUCER=$2
PORT=$3
PKCS11_MODULE=$4

if [ -z "$HOST_IP" ] || [ -z "$PRODUCER" ] || [ -z "$PORT" ] || [ -z "$PKCS11_MODULE" ]; then
    echo "Error: Missing required parameters"
    echo "Usage: $0 <host_ip> <producer> <port> <pkcs11-module>"
    exit 1
fi

rm -rf "$PROJECT_ROOT/db"
PSIBASE_ADMIN_IP=$HOST_IP psinode "$PROJECT_ROOT/db" -p "$PRODUCER" -l "$PORT" --pkcs11-module="$PKCS11_MODULE"
