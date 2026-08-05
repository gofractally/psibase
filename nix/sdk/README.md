# Package-dev SDK

Rust-oriented SDK for building psibase packages **without** cloning this monorepo
and without a local `build/` tree. See [`../sdk-dx-plan.md`](../sdk-dx-plan.md).

## Quick start (x86_64-linux)

```bash
mkdir my-apps && cd my-apps
nix flake init -t github:gofractally/psibase/mm/nix-pkg-dev#package
direnv allow   # or: nix develop

psiapp chain up 8090
psiapp new my-app
cd packages/MyApp/ui && yarn && yarn build
cd .. && cargo-psibase package
cargo-psibase install -a http://psibase.localhost:8090/
psiapp chain down
```

## What `nix develop .#sdk` provides

- Prebuilt `psinode` / `psibase` / `psitest` from `packages.psidk`
- `cargo-psibase` from the Release tarball when present; otherwise **installed from
  crates.io** at `nix/release.nix` → `cargoPsibaseVersion` (currently `0.23.0`)
- Rust 1.86 + wasm targets, cargo-component / cargo-generate / cargo-edit
- Node 20 + Yarn, wasm-pack / wasm-tools / binaryen
- Flake `wasi-sdk`, mkcert, SoftHSM
- `PSIBASE_DATADIR` → store `share/psibase` (full package set)
- **Local chain:** `psiapp chain up|down|status`
- **New app:** `psiapp new <name>` → `nix/sdk/package-templates` (out-of-tree `basic-01`)

You do **not** get: C++/Boost/CMake native toolchain, mdbook, monorepo `build/` on `PATH`.

### Local chain (`psiapp chain`)

| | |
|--|--|
| Host | `psibase.localhost` (required for virtual hosting — not a bare IP) |
| Default API | `http://psibase.localhost:8080/` |
| State | `$XDG_STATE_HOME/psibase-devnet` (override with `PSIBASE_DEVNET_DIR`) |
| Boot | Runs `psibase boot` with the packaged set after `psinode` listens |

Keep **psibase CLI and chain on the same release** (SDK 0.23 tooling with an
SDK-booted chain). A newer monorepo `build/psibase` will garble account names.

### New app (`psiapp new`)

Runs `cargo-generate` against [`package-templates/`](package-templates/) into
`./packages`. That tree vendors Host/Transact/Permissions WIT and uses crates.io
deps (no monorepo `packages/user` paths). UI is a standalone Vite app using
on-chain `@psibase/common-lib`.

Monorepo contributors still use `package-templates/basic-01` via
`cargo generate -p ./package-templates/ --destination ./packages/user/ …`.

## Flake template (`#package`)

`nix/sdk/template/` — standalone workspace under `packages/`.

## Package artifact only

```bash
nix build .#psidk
./result/bin/psibase --version
```

Shared Releases pin: [`../release.nix`](../release.nix).

## Not this SDK

| Concern | Where |
|---------|--------|
| Contributor monorepo toolchain | `nix develop` / `nix/dev/shell.nix` |
| Thin node runtime / NixOS | `packages.psibase` / `nix/deploy/` |
| Contributor Launch/Continue | `.vscode/scripts/launch.sh` |
| Monorepo app templates | `package-templates/basic-01` |
