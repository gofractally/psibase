#!/usr/bin/env bash
# Download a pinned psibase release SDK (psinode, psibase CLI, boot packages)
# into e2e/.cache/psidk. Override with PSIDK_VERSION / PSIDK_FLAVOR.
set -euo pipefail
VERSION="${PSIDK_VERSION:-v0.29.0-pre}"
FLAVOR="${PSIDK_FLAVOR:-ubuntu-2404}"   # ubuntu-2204 | ubuntu-2404 | ubuntu-2604
DIR="$(cd "$(dirname "$0")/.." && pwd)/.cache"
mkdir -p "$DIR"
URL="https://github.com/gofractally/psibase/releases/download/${VERSION}/psidk-${FLAVOR}.tar.gz"
echo "Fetching $URL"
rm -rf "$DIR/psidk" "$DIR/psidk-${FLAVOR}"
curl -fL "$URL" | tar xz -C "$DIR"
mv "$DIR/psidk-${FLAVOR}" "$DIR/psidk"
"$DIR/psidk/bin/psinode" --version
