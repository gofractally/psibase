#!/usr/bin/env bash
# Regenerate e2e/lib/verified-e2e-account-names.json using the on-chain
# account_number compression round-trip check (psibase_names).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
OUT="${ROOT}/packages/user/Homepage/ui/e2e/lib/verified-e2e-account-names.json"
COUNT="${1:-512}"

cd "${ROOT}/rust/psibase_names"
cargo run --bin generate_e2e_account_names -- "${OUT}" "${COUNT}"
