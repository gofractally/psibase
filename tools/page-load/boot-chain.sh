#!/bin/bash
# Boot a throwaway chain for the page-load baseline (gofractally/psibase#2315).
#
#   boot-chain.sh <build-dir> [port] [chain-dir]
#
# Starts psinode from <build-dir> on https://psibase.localhost:<port> (default
# 8553) in <chain-dir> (default: a new directory under /tmp), boots DevDefault,
# installs the sign-up service with its development provider (no identity
# check, so no stand-in OAuth server is needed), creates the sponsor account
# and turns the identity gate on, so a signed-out visit to an app is redirected
# to the sign-in page as it is on a deployment.
#
# Prints the chain directory and the node's PID; the node keeps running.
# Stop it with:  kill <pid>     (the PID is also in <chain-dir>/psinode.pid)
#
# Extra psinode options go in PSINODE_ARGS, e.g. PSINODE_ARGS="--http-timeout 120"
# (the mobile profile needs it: see README.md).
#
# TLS: uses the developer CA in ~/.psibase-dev-ca (a certificate for
# psibase.localhost and *.psibase.localhost that the system trusts). Passkeys
# need a secure context, hence https.
set -euo pipefail
BUILD=${1:?usage: boot-chain.sh <build-dir> [port] [chain-dir]}
PORT=${2:-8553}
DIR=${3:-$(mktemp -d /tmp/pl-chain.XXXXXX)}
CERT=${PSIBASE_TLS_CERT:-$HOME/.psibase-dev-ca/psibase.localhost.pem}
KEY=${PSIBASE_TLS_KEY:-$HOME/.psibase-dev-ca/psibase.localhost.key}
HOST=psibase.localhost
mkdir -p "$DIR"
cd "$BUILD"
[ -x ./psinode ] && [ -x ./rust/release/psibase ] || { echo "no psinode / psibase in $BUILD" >&2; exit 1; }

nohup ./psinode "$DIR" --producer prod --host $HOST \
    --listen "https://127.0.0.1:$PORT" --listen "$DIR/socket" \
    --tls-cert "$CERT" --tls-key "$KEY" ${PSINODE_ARGS:-} > "$DIR/node.log" 2>&1 &
PID=$!
echo $PID > "$DIR/psinode.pid"
for _ in $(seq 1 60); do [ -S "$DIR/socket" ] && break; sleep 0.5; done
kill -0 $PID 2>/dev/null || { echo "psinode did not start; see $DIR/node.log" >&2; exit 1; }

P() { ./rust/release/psibase "$@" --proxy "unix:$DIR/socket"; }
API="-a http://$HOST/"
SRC="--package-source share/psibase/packages"
P boot $API -p prod $SRC DevDefault > "$DIR/boot.log" 2>&1 || { echo "boot failed; see $DIR/boot.log" >&2; kill $PID; exit 1; }
sleep 5
P install $API $SRC --local -y XSignup > "$DIR/signup-install.log" 2>&1 || { echo "XSignup install failed" >&2; kill $PID; exit 1; }

R="--resolve x-signup.$HOST:$PORT:127.0.0.1 --resolve x-http.$HOST:$PORT:127.0.0.1"
U="https://x-signup.$HOST:$PORT"
curl -sS $R -X PUT "$U/config" -H "Content-Type: application/json" \
    -d '{"open":true,"sponsor":"signupsvc","dev_provider":true,"providers":[]}' -o /dev/null -w "signup config: %{http_code}\n"
curl -sS $R "$U/sponsor" | python3 -c "import json,sys;open('$DIR/sponsor.pem','w').write(json.load(sys.stdin)['key'])"
P create $API -k "$DIR/sponsor.pem" signupsvc > "$DIR/sponsor.log" 2>&1 || { echo "sponsor account failed; see $DIR/sponsor.log" >&2; }
curl -sS $R -X PUT "https://x-http.$HOST:$PORT/identity_gate" -H "Content-Type: application/json" \
    -d '{"required":true}' -o /dev/null -w "identity gate: %{http_code}\n"
echo "signup status: $(curl -sS $R "$U/status")"
echo "chain: $DIR"
echo "pid:   $PID"
echo "url:   https://$HOST:$PORT"
