#!/usr/bin/env bash
# Scaffold a stand-alone package from package-templates/basic-01.
# Usage:
#   ./package-templates/new.sh [--destination DIR] [--name NAME] [--version VER] [cargo-generate args…]
# Destination, name, and version are prompted when omitted (version default
# from rust/Cargo.toml [workspace.package]).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST=""
NAME=""
VERSION=""
PASSTHRU=()
SILENT=0

read_rust_workspace_version() {
  local cargo_toml="$1"
  sed -n '/^\[workspace.package\]/,/^\[/{s/^version = "\([^"]*\)"/\1/p}' "$cargo_toml" | head -1
}

# If start (or an ancestor) is a psibase monorepo checkout, print absolute rust/.
find_monorepo_rust() {
  local d="$1"
  while [[ -n "$d" && "$d" != "/" ]]; do
    if [[ -f "$d/rust/Cargo.toml" && -d "$d/rust/psibase" ]]; then
      echo "$d/rust"
      return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

# Relative path from package root to monorepo rust/, or "" for crates.io.
default_psibase_rust_root() {
  local app_dir="$1"
  local search_from="$2"
  local rust_abs
  if rust_abs="$(find_monorepo_rust "$search_from")"; then
    realpath -m --relative-to="$app_dir" "$rust_abs"
  else
    echo ""
  fi
}

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

Scaffolds a stand-alone package (own Cargo workspace) using
package-templates/basic-01. Does not register the package in any parent
workspace.

Version defaults to rust/Cargo.toml [workspace.package]. Prompted when
omitted unless --silent.

If the destination sits inside a psibase monorepo, psibase crates use a
relative path to that tree's rust/; otherwise crates.io pins.
EOF
      exit 0
      ;;
    *)
      PASSTHRU+=("$1")
      shift
      ;;
  esac
done

DEFAULT_VERSION="$(read_rust_workspace_version "$ROOT/rust/Cargo.toml")"
if [[ -z "$DEFAULT_VERSION" ]]; then
  echo "error: could not read version from $ROOT/rust/Cargo.toml" >&2
  exit 1
fi

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

if [[ -z "$VERSION" ]]; then
  if [[ "$SILENT" -eq 1 ]]; then
    VERSION="$DEFAULT_VERSION"
  else
    read -r -p "Psibase version [$DEFAULT_VERSION]: " VERSION
    VERSION="${VERSION:-$DEFAULT_VERSION}"
  fi
fi

CAMEL="$(echo "$NAME" | sed -E 's/(^|-)([a-z])/\U\2/g')"
APP_DIR="$DEST/$CAMEL"
RUST_ROOT="$(default_psibase_rust_root "$APP_DIR" "$DEST")"

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

if [[ -n "$RUST_ROOT" ]]; then
  echo "Generating '$NAME' into $APP_DIR (psibase $VERSION, path $RUST_ROOT)…"
else
  echo "Generating '$NAME' into $APP_DIR (psibase $VERSION, crates.io)…"
fi
"${GENERATE[@]}" \
  --path "$ROOT/package-templates" \
  --destination "$STAGE" \
  --init \
  -v \
  --allow-commands \
  --name "$NAME" \
  --define "version=$VERSION" \
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
