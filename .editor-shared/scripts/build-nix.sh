#!/usr/bin/env bash
set -euo pipefail

# Build ./result with `nix build`. launch-nix.sh runs it.
# Unlike build.sh this is not incremental: any change to a tracked file
# rebuilds every layer.
#
# Extra arguments go to `nix build`, e.g. --dry-run.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

cd "$PROJECT_ROOT"
nix build .#psibase "$@"
echo "Built $PROJECT_ROOT/result" >&2
