#!/usr/bin/env bash
# Regenerate e2e/lib/verified-e2e-account-names.json using the on-chain
# account_number compression round-trip check (via psibase_names).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
OUT="${ROOT}/packages/user/Homepage/ui/e2e/lib/verified-e2e-account-names.json"
COUNT="${1:-512}"
MANIFEST="${ROOT}/packages/user/Homepage/ui/e2e/tools/e2e-account-names/Cargo.toml"

cargo run --manifest-path "${MANIFEST}" -- "${OUT}" "${COUNT}"
