# Nix-Based Development Environment for Psibase (Linux)

How to use Nix as an alternative to the Docker-based development environment (psibase-contributor).
**Supported platforms: Linux x86_64 and Linux aarch64.**
Not (yet) supported: macOS

# Overview

The Nix configuration includes

- **C++**: GCC (native), LLVM/Clang 18 (WASM, clangd), Boost, CMake
- **Rust**: 1.86.0 (pinned) with WASM targets (`wasm32-unknown-unknown`, `wasm32-wasip1`)
- **WebAssembly**: WASI SDK 29, wasm-pack, wasm-tools, binaryen
- **JavaScript**: Node.js 20, Yarn
- **Tools**: clangd, gdb, direnv, mkcert, SoftHSM2, gh, cursor-agent (cursor-cli)
- **Docs**: mdbook with plugins

You do **not** need to pre-install Rust, Node, or other dev tools; `nix develop` provides everything.

# Prerequisites

- **Nix** (the pkg mgr, not the OS) *with flakes enabled*
- **direnv** (optional but recommended)

## Install Nix (Linux)

There are 2 primary ways to install Nix. Recommended: Determinate Systems' installer

### RECOMMENDED: Determinate Systems' installer
```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

### Fallback: the official installer

```bash
sh <(curl -L https://nixos.org/nix/install) --daemon
```

Note: the default installer requires you manually enable flakes in `~/.config/nix/nix.conf` or `/etc/nix/nix.conf`:

```
experimental-features = nix-command flakes
```

### Configuring for NixOS

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" ];
```

# Quick Start

## 1. Enter the development shell

From the **psibase** repo root:

```bash
nix develop
```

## 2. One-time Setup

### 2.1 For VS Code and forks: run .vscode/scripts/env-setup.sh
This will ensure your build and dev envs can find everything they need

### 2.2 Initializing/Configuring the Environment (and IDE)

#### Launching IDE within the nix-shell
Launch Cursor (or another IDE) from the dev shell so the editor and its terminals inherit the flake environment (including `HOST_IP` for Launch/Continue tasks):

```bash
nix develop -c cursor /path/to/your.code-workspace
```

Or use a wrapper script (see `~/repos/cursor-workspaces/cursor-psibase-via-nix.sh`).

## 3. Build a runtime package (`nix build`)

From the repo root, with no extra tools beyond Nix:

```bash
nix build
# or: nix build .#psibase
```

This compiles psibase from source (C++, Rust, WASM, Yarn UIs) and installs the runtime layout.

Yarn UIs (including XAdmin) are separate store paths (`nix build .#psibase-yarn-uis`). A C++-only change reuses those paths and skips Vite. XAdmin’s yarn build runs cargo-component + jco in `#psibase-yarn-uis` (`xadmin`).

Wasm third-party libs (Botan, OpenSSL, zlib, gmp) are `nix build .#psibase-wasm-deps`. A service-code change reuses that path and skips those WASI compiles.

The Nix package builds `package-index` plus `psinode`/`psitest`/snapshot tools (`-DBUILD_DOC=ON`, so `Docs.psi` is in the index like every other default app). It does not ninja `all`, so tester packages and extra man-page work stay skipped. `reserved-names` still runs in the main ninja because the package index needs it.

The `psibase` CLI is `nix build .#psibase-cli`. A C++-only change reuses that binary.

Wasm plugins from the `packages/` cargo-component workspace (plus component-parser) are `nix build .#psibase-plugins`. A C++-only change reuses those `.wasm` files. System cargo-psibase packages (AuthDyn, …) are `#psibase-rs-packages-system`. User packages (Tokens, Fractals, …) are `#psibase-rs-packages-user` (needs Yarn dist for a few UIs). `#psibase-rs-packages` joins both.

C++ `psinode`/`psitest` are `nix build .#psibase-native`. WASI service wasm and snapshot tools are `nix build .#psibase-wasm-services` (uses `psitest` from `#psibase-native` for schema generation). A psinode-only change does not rebuild C++ service wasm. A plugin or Yarn UI change reuses both and only re-packs `.psi` files (`package-index`).

Rust services packed by `cargo-psibase` are `#psibase-rs-packages-system` and `#psibase-rs-packages-user`. Schema generation uses `psitest` from `#psibase-native`. A Fractals/UI change does not rebuild AuthDyn.

WASI SDK 29 / LLVM 21 emits `call_indirect` with a LEB table index; eos-vm requires a single `0x00` byte. `nix/fix-psi-wasm.sh` rewrites compiled `.wasm` (encoding-only, not `-O1`) in `#psibase-wasm-services` and `#psibase-rs-packages` so packing and `index.json` hashes see the final bytes.

`nix build` turns on these CMake flags (all default OFF, so local cmake / `nix develop` still builds UIs, plugins, and packing) after copying prebuilt outputs into the build dir:

| Flag | Purpose |
|------|---------|
| `PSIBASE_COMPILE_ONLY` | C++ compile without packing UIs/plugins (`#psibase-native`, `#psibase-wasm-services`) |
| `PSIBASE_PREBUILT_WASM_DEPS` | Reuse `#psibase-wasm-deps` |
| `PSIBASE_PREBUILT_WASM_SERVICES` | Reuse compiled C++ service wasm |
| `PSIBASE_PREBUILT_UI` | Reuse Yarn `dist/` |
| `PSIBASE_PREBUILT_PLUGINS` | Reuse cargo-component wasm |
| `PSIBASE_PREBUILT_CLI` | Reuse `#psibase-cli` |
| `PSIBASE_PREBUILT_NATIVE` | Reuse `#psibase-native` while packing or compiling C++ wasm |
| `PSIBASE_PREBUILT_RS_PACKAGES` | Reuse `#psibase-rs-packages` |

```
result/bin/{psinode,psibase,psitest}
result/share/psibase/{config.in,packages,wasm}
```

That layout matches [psibase-nix](https://github.com/gofractally/psibase-nix) (`services.psibase.package`). First run vendors Cargo/Yarn into fixed-output derivations (network allowed only there); later builds are offline and sandboxed.

`nix develop` is the contributor loop (edit, incremental `cmake --build` into `./build`). `nix build` is the reproducible package (`result/` → `/nix/store/…`). Do not mix them: Nix never writes the package into `./build`.

## 4. Run a chain from the Nix package

Launch/Continue (`launch.sh`) resolves psinode in this order: `build/psinode` (uninstalled ninja), `build/psidk/bin/psinode` (cmake install), `result/bin/psinode` (`nix build`), then `PATH`. Incremental cmake therefore wins over a leftover package.

```bash
nix build
.editor-shared/scripts/launch.sh          # needs HOST_IP; nix develop sets 127.0.0.1
# or:
nix run . -- /path/to/db -p myprod -l 8080
```

`nix run` always runs the store package (and will full-rebuild it if inputs changed). It does not use `./build`.

## 5. Build and Launch (cmake, inside nix develop)
Build or Launch with the tasks.json buttons or by running the same command at the nix shell. This uses `./build` and is the fast edit loop, not the packaged store path.

# Environment variables set by the shell

| Variable | Description |
|----------|-------------|
| `HOST_IP` | Loopback admin IP (`127.0.0.1`) for Launch/Continue tasks and `launch.sh` |
| `WASI_SDK_PREFIX` | Path to WASI SDK |
| `CC` / `CXX` | GCC via Nix stdenv |
| `LIBCLANG_PATH` | For rust-analyzer |
| `RUST_SRC_PATH` | For rust-analyzer |
| `IN_NIX_SHELL` | Set to `1` when in a nix shell |

# Troubleshooting

- **Launch uses cmake instead of the Nix package**: `launch.sh` prefers `build/psinode`, then `build/psidk/bin`, when they exist. Use `./result/bin/psinode` or `nix run` to run the packaged node.
- **psinode not found**: Run `nix build` (package) or `build.sh` inside `nix develop` (incremental cmake).
- **"command not found"** at the cli: Ensure you're in a `nix develop` shell.
- **Wrong cargo tool versions**: cargo tools are pinned and provided by the flake. If `which cargo-component` does not point at the right thing, a host-installed copy may be shadowing it on `PATH`
- **ICU / ABI errors**: Ensure you're in the Nix shell and do a clean build (`rm -rf build && mkdir build`). The flake sets `ICU_ROOT` and `CMAKE_IGNORE_PATH` to avoid picking up system ICU from `/usr/lib`.
- **cargo-component "Invalid cross-device link"**: The flake sets `TMPDIR` under `$HOME/.cache` so temp files stay on the same filesystem as the repo. If you still see this from a Cursor agent/sandbox run, retry the build from a normal terminal in `nix develop`.
- **Rust analyzer not finding deps**: Run the editor from inside the Nix shell or use the direnv extension.

# Updating the environment

```bash
nix flake update
nix develop
```

# Files

- `flake.nix` / `flake.lock` — Nix flake at repo root
- `nix/psibase.nix` — from-source `packages.psibase` / `packages.default`
- `nix/yarn-uis.nix` — per-UI Yarn packages including XAdmin
- `nix/rust-toolchain.toml` — Rust version and targets

# Relationship to Docker

Docker (psibase-contributor) remains a supported path. Nix is an **additional** option for Linux: one clone of psibase, then `nix develop` and build.
