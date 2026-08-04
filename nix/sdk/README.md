# Package-dev SDK

Rust-oriented SDK for building psibase packages **without** cloning this monorepo
and without a local `build/` tree. See [`../sdk-dx-plan.md`](../sdk-dx-plan.md).

## Quick start (x86_64-linux)

```bash
# From this flake (local checkout or a release tag):
nix develop github:gofractally/psibase/v0.23.0-pre#sdk
# or, in a checkout of this branch:
nix develop .#sdk
```

What you get:

- Prebuilt `psinode` / `psibase` / `psitest` from `packages.psidk`
- Rust 1.86 + wasm targets, cargo-component / cargo-generate / cargo-edit
- Node 20 + Yarn, wasm-pack / wasm-tools / binaryen
- Flake `wasi-sdk`, mkcert, SoftHSM
- `PSIBASE_DATADIR` pointing at the store `share/psibase` (full package set)

You do **not** get: C++/Boost/CMake native toolchain, mdbook, monorepo `build/` on `PATH`.

### `cargo-psibase` (interim)

Current Release tarballs omit `bin/cargo-psibase`. Until a tag ships it in psidk:

```bash
cargo install cargo-psibase --version 0.23.0 --locked
# or auto-install on shell entry:
PSIBASE_SDK_INSTALL_CARGO_PSIBASE=1 nix develop .#sdk
```

## Package artifact only

```bash
nix build .#psidk
./result/bin/psibase --version
```

| Included in `packages.psidk` | Excluded (Rust-only) |
|------------------------------|----------------------|
| `bin/{psinode,psibase,psitest}` | `share/wasi-sysroot` (~241M) |
| `bin/cargo-psibase` when present in the tarball | `share/psibase/cmake` |
| Full `share/psibase/packages` | `bin/psidk-cmake-args` |
| `share/psibase/{config.in,wasm,services,python,licenses}` | `share/gdb` |
| man pages | |

Layout contract: `$out/{bin,share/psibase}`.

Shared Releases pin: [`../release.nix`](../release.nix).

## Not this SDK

| Concern | Where |
|---------|--------|
| Contributor monorepo toolchain | `nix develop` / `nix/dev/shell.nix` |
| Thin node runtime / NixOS | `packages.psibase` / `nix/deploy/` |
| Flake templates / local-chain helper | later plan phases |

## Manual local chain (until Phase 4)

```bash
nix develop .#sdk
mkdir -p /tmp/psibase-devnet && cd /tmp/psibase-devnet
psinode ./db --host psibase.localhost --listen 8080 &
# wait for listen, then:
psibase boot -a http://psibase.localhost:8080/ -p prod
```
