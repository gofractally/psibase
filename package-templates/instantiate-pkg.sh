#!/usr/bin/env bash
# Instantiate package-templates/basic-01 into a stand-alone package.
# Usage:
#   ./package-templates/instantiate-pkg.sh [--destination DIR] [--name NAME] [--version VER] [cargo-generate args…]
#
# Wraps cargo-generate so generation can land under packages/user (a virtual
# workspace) via a temp stage. Version default and local psibase crate paths
# are filled by template .rhai hooks when possible; this script exports
# PSIBASE_INSTANTIATE_APP_DIR so those hooks compute paths for the final
# location (not the temp stage).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST=""
NAME=""
VERSION=""
PASSTHRU=()
SILENT=0

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
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --silent|-s)
      SILENT=1
      PASSTHRU+=("$1")
      shift
      ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--destination DIR] [--name NAME] [--version VER] [cargo-generate args…]

Instantiates package-templates/basic-01 as a stand-alone Cargo workspace.
Does not register the package in any parent workspace.

Stages through a temp dir so the result can land under packages/user (virtual
workspace). Template hooks fill psibase version (from rust/Cargo.toml when
inside a monorepo) and local_path_psibase* (else crates.io). Pass --version to
override the hook/default.
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
  if [[ "$SILENT" -eq 1 ]]; then
    echo "error: --destination is required with --silent" >&2
    exit 1
  fi
  read -r -p "Destination directory (parent of the new package): " DEST
fi
if [[ -z "$DEST" ]]; then
  echo "error: destination is required" >&2
  exit 1
fi
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

if [[ -z "$NAME" ]]; then
  if [[ "$SILENT" -eq 1 ]]; then
    echo "error: --name is required with --silent" >&2
    exit 1
  fi
  read -r -p "Package name (≤10 lowercase kebab-case): " NAME
fi
if [[ -z "$NAME" ]]; then
  echo "error: package name is required" >&2
  exit 1
fi

CAMEL="$(echo "$NAME" | sed -E 's/(^|-)([a-z])/\U\2/g')"
APP_DIR="$DEST/$CAMEL"

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

DEFINES=(--define "description=An example application")
if [[ -n "$VERSION" ]]; then
  DEFINES+=(--define "version=$VERSION")
fi

echo "Instantiating '$NAME' into $APP_DIR…"
# Final app dir for .rhai path/version hooks (stage destination is not final).
export PSIBASE_INSTANTIATE_APP_DIR="$APP_DIR"
"${GENERATE[@]}" \
  --path "$ROOT/package-templates" \
  --destination "$STAGE" \
  --init \
  -v \
  --allow-commands \
  --name "$NAME" \
  "${DEFINES[@]}" \
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
