# Plugin WIT dependency graph

Extracted from `wasm-plugin-memory-history.md` (Phase 7, 2026-04-14), deleted in `344d1d8e8`.
Static analysis of Config-loaded plugins via WIT `impl.wit` imports.

## Plugin dependency graph (from WIT `impl.wit` imports)

Only cross-plugin imports counted (excludes `host:*`, `wasi:*`, `supervisor:*`):

```
config       → packages, staged-tx, producers, branding, transact, virtual-server, tokens, symbol
packages     → accounts, setcode, sites, staged-tx, transact
staged-tx    → accounts, transact, clientdata, permissions
transact     → clientdata, accounts, permissions, virtual-server
accounts     → clientdata, transact, permissions, auth-sig, invite
auth-sig     → accounts, transact, clientdata, permissions
permissions  → accounts
virtual-server → tokens, accounts
branding     → transact, staged-tx, sites
symbol       → transact, permissions, tokens, staged-tx, nft
sites        → transact, permissions
setcode      → transact, permissions
host-common  → accounts
host-auth    → transact
host-crypto  → permissions
web-crypto   → clientdata
aes          → kdf
```

Leaf plugins (no cross-plugin imports): **tokens**, **base64**, **kdf**, **clientdata**, **host-types**.

Cycles: accounts ↔ permissions, accounts ↔ transact (mutual import availability, not infinite recursion).
