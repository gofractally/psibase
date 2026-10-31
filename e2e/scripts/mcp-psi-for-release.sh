#!/usr/bin/env bash
# Build Mcp.psi whose plugin targets the transact:plugin WIT of the devnet
# release (v0.29.0-pre names the interface `intf`; this branch names it `api`).
# Output: e2e/.cache/Mcp-release.psi (gitignored) (use as MCP_PSI).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TAG=${PSIDK_TAG:-v0.29.0-pre}
P=$ROOT/packages/user/Mcp/plugin
WIT=$ROOT/e2e/.cache/wit-$TAG/transact; mkdir -p "$WIT"
git -C "$ROOT" show "$TAG:packages/system/Transact/plugin/wit/world.wit" > "$WIT/world.wit"
cp "$P/Cargo.toml" "$P/Cargo.toml.bak"; cp "$P/src/lib.rs" "$P/src/lib.rs.bak"
restore() { mv "$P/Cargo.toml.bak" "$P/Cargo.toml"; mv "$P/src/lib.rs.bak" "$P/src/lib.rs"; }
trap restore EXIT
sed -i "s|\"transact:plugin\" = { path = \"[^\"]*\" }|\"transact:plugin\" = { path = \"$WIT/world.wit\" }|" "$P/Cargo.toml"
sed -i 's|transact::plugin::api::add_action_to_transaction|transact::plugin::intf::add_action_to_transaction|' "$P/src/lib.rs"
cd "$ROOT/packages/user"
PATH=$HOME/.cargo/bin:$PATH "$ROOT/rust/target/release/cargo-psibase" psibase package --manifest-path Mcp/Cargo.toml
cp target/wasm32-wasip1/release/packages/Mcp.psi "$ROOT/e2e/.cache/Mcp-release.psi (gitignored)"
