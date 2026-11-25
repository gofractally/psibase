#!/usr/bin/env bash
# Build Banx and deploy to pinkduck.lol.
#
#   ./packages/user/Banx/deploy.sh
set -euo pipefail

API="${API:-https://pinkduck.lol}"
SENDER=banx-app
QUERY="${SENDER}+1"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
PACKAGES="$REPO_ROOT/packages"
USER_WS="$PACKAGES/user"
SCHEMA="$USER_WS/target/wasm32-wasip1/release"
PSI="$SCHEMA/packages/Banx.psi"
WORKDIR=$(mktemp -d)
KEY="$WORKDIR/banx-app.pem"
EXTRACT="$WORKDIR/psi"
trap 'rm -rf "$WORKDIR"' EXIT

umask 077
cat >"$KEY" <<'PEM'
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3sKwjgubVvelx8TU
3tXLzQdRFcNbXshCXbTMXkQlY8+hRANCAAQj7YY/Q/0OiLO5V3qTPG0QYb5xiO3m
97DLB6+Ulqt95a0T0iouqoo+XcnokENmp5XjH2+uRcfPGBtrE2D7FZVG
-----END PRIVATE KEY-----
PEM

need() {
    command -v "$1" >/dev/null || {
        echo "error: missing $1" >&2
        exit 1
    }
}
need cargo-psibase
need psibase
need unzip
need curl
need yarn

account_exists() {
    local name=$1
    local json
    json=$(curl -sS --max-time 20 \
        "https://accounts.${API#https://}/graphql" \
        -H 'content-type: application/json' \
        -d "{\"query\":\"{ getAccount(accountName: \\\"${name}\\\") { accountNum } }\"}")
    [[ "$json" == *'"accountNum"'* ]]
}

push_json() {
    local file=$1
    psibase push -a "$API" -s "$KEY" "$file"
}

if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
    echo "==> UI"
    (cd "$PACKAGES" && yarn install && yarn workspace @psibase/banx-ui build)

    echo "==> package"
    (cd "$SCRIPT_DIR" && cargo-psibase -p banx-pkg package)
fi

[[ -f "$PSI" ]] || {
    echo "error: missing $PSI (run without SKIP_BUILD=1)" >&2
    exit 1
}

mkdir -p "$EXTRACT"
unzip -o "$PSI" -d "$EXTRACT" >/dev/null

echo "==> create ${QUERY} (if needed)"
if account_exists "$QUERY"; then
    echo "    already exists"
else
    psibase create -a "$API" -s "$KEY" -S "$SENDER" -o "$SENDER" "$QUERY"
fi

echo "==> deploy ${SENDER}"
psibase deploy -a "$API" -s "$KEY" "$SENDER" \
    "$EXTRACT/service/${SENDER}.wasm" "$SCHEMA/banx.schema.json"

echo "==> deploy ${QUERY}"
psibase deploy -a "$API" -s "$KEY" "$QUERY" \
    "$EXTRACT/service/${SENDER}/1.wasm" "$SCHEMA/r-banx.schema.json"

echo "==> registerServer + dyn-ld + enableSpa + init"
ACTIONS="$EXTRACT/actions.json"
cat > "$ACTIONS" <<EOF
[
  {
    "sender": "${SENDER}",
    "service": "http",
    "method": "registerServer",
    "data": { "server": "${QUERY}" }
  },
  {
    "sender": "${SENDER}",
    "service": "dyn-ld",
    "method": "link",
    "data": {
      "group": "Banx",
      "deps": [
        {"name": "banx", "service": "${SENDER}"},
        {"name": "r-banx", "service": "${QUERY}"},
        {"name": "accounts", "service": "accounts"},
        {"name": "config", "service": "config"},
        {"name": "host", "service": "host"},
        {"name": "http", "service": "http"},
        {"name": "invite", "service": "invite"},
        {"name": "permissions", "service": "perms"},
        {"name": "sites", "service": "sites"},
        {"name": "tokens", "service": "tokens"},
        {"name": "r-tokens", "service": "tokens+1"},
        {"name": "transact", "service": "transact"}
      ]
    }
  },
  {
    "sender": "${SENDER}",
    "service": "sites",
    "method": "enableSpa",
    "data": { "enable": true }
  },
  {
    "sender": "${SENDER}",
    "service": "${SENDER}",
    "method": "init",
    "data": {}
  }
]
EOF
push_json "$ACTIONS"

echo "==> upload UI"
psibase upload -a "$API" -s "$KEY" -S "$SENDER" -r "$EXTRACT/data/${SENDER}"

host=${API#https://}
host=${host#http://}
host=${host%/}
echo "done: https://${SENDER}.${host}/"
