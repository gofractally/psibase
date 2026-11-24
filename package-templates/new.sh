#!/usr/bin/env bash
# Scaffold a stand-alone package from package-templates/basic-01.
# Usage:
#   ./package-templates/new.sh [--destination DIR] [--name NAME] [cargo-generate args…]
# Destination and name are prompted when omitted.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST=""
NAME=""
PASSTHRU=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --destination|-d)
      DEST="${2:-}"
      shift 2
      ;;
    --name|-n)
      NAME="${2:-}"
      shift 2
      ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--destination DIR] [--name NAME] [cargo-generate args…]

Scaffolds a stand-alone psibase package (own Cargo workspace) using
package-templates/basic-01. Does not register the package in any parent
workspace.

When run from this monorepo, psibase crates are pinned to rust/ via a
relative path. Pass --define psibase_rust_root= to force crates.io pins.
EOF
      exit 0
      ;;
    *)
      PASSTHRU+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$DEST" ]]; then
  read -r -p "Destination directory (parent of the new package): " DEST
fi
if [[ -z "$DEST" ]]; then
  echo "error: destination is required" >&2
  exit 1
fi
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

if [[ -z "$NAME" ]]; then
  read -r -p "Package name (≤8 lowercase kebab-case): " NAME
fi
if [[ -z "$NAME" ]]; then
  echo "error: package name is required" >&2
  exit 1
fi

CAMEL="$(echo "$NAME" | sed -E 's/(^|-)([a-z])/\U\2/g')"
APP_DIR="$DEST/$CAMEL"
RUST_ROOT="$(realpath -m --relative-to="$APP_DIR" "$ROOT/rust")"

# Binary is `cargo-generate` with a `generate` subcommand; cargo subcommand is
# `cargo generate` (same flags).
if command -v cargo >/dev/null 2>&1 && cargo generate --help >/dev/null 2>&1; then
  GENERATE=(cargo generate)
elif command -v cargo-generate >/dev/null 2>&1; then
  GENERATE=(cargo-generate generate)
else
  echo "error: cargo-generate not found (install: cargo install cargo-generate)" >&2
  exit 1
fi

if [[ -e "$APP_DIR" ]]; then
  echo "error: $APP_DIR already exists" >&2
  exit 1
fi

# Stage into a temp dir: cargo-generate inspects destination/Cargo.toml and
# fails on virtual workspaces (e.g. packages/user/Cargo.toml).
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/psibase-new.XXXXXX")"
cleanup_stage() { rm -rf "$STAGE"; }
trap cleanup_stage EXIT

echo "Generating '$NAME' into $APP_DIR (psibase from $RUST_ROOT)…"
"${GENERATE[@]}" \
  --path "$ROOT/package-templates" \
  --destination "$STAGE" \
  --init \
  -v \
  --allow-commands \
  --name "$NAME" \
  --define "psibase_rust_root=$RUST_ROOT" \
  "${PASSTHRU[@]}" \
  basic-01

if [[ ! -d "$STAGE/$CAMEL" ]]; then
  echo "error: expected $STAGE/$CAMEL after generate" >&2
  exit 1
fi
mv "$STAGE/$CAMEL" "$DEST/"
trap - EXIT
cleanup_stage

echo ""
echo "Next:"
echo "  cd $APP_DIR/ui && yarn && yarn build"
echo "  cd $APP_DIR && cargo-psibase package"
