# Package-dev SDK

Rust-oriented SDK for building psibase packages **without** cloning this monorepo
and without a local `build/` tree. See [`../sdk-dx-plan.md`](../sdk-dx-plan.md).

## Quick start (x86_64-linux)

```bash
# Scaffold a workspace (after this flake is on a remote tag/branch):
mkdir my-apps && cd my-apps
nix flake init -t github:gofractally/psibase#package

# Or from a local checkout of this branch:
nix flake init -t path:/path/to/psibase#package

direnv allow   # or: nix develop
psidk-up
cd packages/example
cargo-psibase package
cargo-psibase install -a http://psibase.localhost:8080/
psidk-down
```

While the SDK exists only on a local branch, point the scaffold’s flake input at it:

```bash
nix flake lock --override-input psibase path:/path/to/psibase
```

## What `nix develop .#sdk` provides

- Prebuilt `psinode` / `psibase` / `psitest` from `packages.psidk`
- `cargo-psibase` from the Release tarball when present; otherwise **installed from
  crates.io** at `nix/release.nix` → `cargoPsibaseVersion` (currently `0.23.0`)
- Rust 1.86 + wasm targets, cargo-component / cargo-generate / cargo-edit
- Node 20 + Yarn, wasm-pack / wasm-tools / binaryen
- Flake `wasi-sdk`, mkcert, SoftHSM
- `PSIBASE_DATADIR` → store `share/psibase` (full package set)
- **Local chain:** `psidk-up` / `psidk-down` (or `psidk-devnet up|down|status`)

You do **not** get: C++/Boost/CMake native toolchain, mdbook, monorepo `build/` on `PATH`.

### Local chain (`psidk-up`)

| | |
|--|--|
| Host | `psibase.localhost` (required for virtual hosting — not a bare IP) |
| Default API | `http://psibase.localhost:8080/` |
| State | `$XDG_STATE_HOME/psibase-devnet` (override with `PSIBASE_DEVNET_DIR`) |
| Boot | Runs `psibase boot` with the packaged set after `psinode` listens |

Same role as `.vscode/scripts/launch.sh` for contributors, but for out-of-tree SDK
users and **includes boot**.

## Flake template (`#package`)

`nix/sdk/template/` — standalone workspace:

```text
Cargo.toml                 # workspace
packages/example/          # first app (rename / add siblings)
flake.nix                  # default shell = psibase#sdk
.envrc
Cargo.lock                 # pinned for Rust 1.86 (do not regenerate casually)
```

## Package artifact only

```bash
nix build .#psidk
./result/bin/psibase --version
```

Shared Releases pin: [`../release.nix`](../release.nix) (`version`, `cargoPsibaseVersion`, `psibaseCrateVersion`).

## Not this SDK

| Concern | Where |
|---------|--------|
| Contributor monorepo toolchain | `nix develop` / `nix/dev/shell.nix` |
| Thin node runtime / NixOS | `packages.psibase` / `nix/deploy/` |
| Contributor Launch/Continue | `.vscode/scripts/launch.sh` |
