# Nix-Based Development Environment for Psibase (Linux)

How to use Nix as an alternative to the Docker-based development environment (psibase-contributor).
**Supported platforms: Linux x86_64 and Linux aarch64.**
Not (yet) supported: macOS

## Overview

The Nix configuration, emulating the current psibase-contributor config provides:

- **C++**: Clang/LLVM 18, Boost, CMake
- **Rust**: 1.86.0 (pinned) with WASM targets (`wasm32-unknown-unknown`, `wasm32-wasip1`)
- **WebAssembly**: WASI SDK 29, wasm-pack, wasm-tools, binaryen
- **JavaScript**: Node.js 20, Yarn
- **Tools**: clangd, gdb, direnv, mkcert, SoftHSM2
- **Docs**: mdbook with mermaid plugin

You do **not** need to pre-install Rust, Node, or other dev tools; `nix develop` provides everything. Some cargo extensions are installed once via `./nix/scripts/setup_prereqs.sh`.

## Prerequisites

- **Nix** (the pkg mgr, not the OS) *with flakes enabled*
- **direnv** (optional but recommended)

### Install Nix (Linux)

There are 2 primary ways to install Nix. Recommended: Determinate Systems' installer

#### RECOMMENDED: Determinate Systems' installer
```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

#### Fallback: the official installer

```bash
sh <(curl -L https://nixos.org/nix/install) --daemon
```

Note: the default installer requires you manually enable flakes in `~/.config/nix/nix.conf` or `/etc/nix/nix.conf`:

```
experimental-features = nix-command flakes
```

#### Configuring for NixOS

Add to `/etc/nixos/configuration.nix`:

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" ];
```

Then `sudo nixos-rebuild switch`.

### Install direnv (Recommended but optional)

- **Ubuntu/Debian**: `sudo apt install direnv` then add `eval "$(direnv hook bash)"` to `~/.bashrc`
- **Fedora/RHEL**: `sudo dnf install direnv` and same hook in `~/.bashrc`
- **Arch**: `sudo pacman -S direnv` and hook in `~/.bashrc` or `~/.zshrc`
- **Via Nix**: `nix profile install nixpkgs#direnv` then add the hook for your shell

## Quick Start

### 1. Enter the development shell

From the **psibase** repo root:

```bash
nix develop
```

### 2. One-time Setup

#### 2.1 Setup cargo things
Inside the `nix develop` shell:

```bash
# Installs cargo-component, cargo-generate, and cargo-edit (pinned for Rust 1.86.0) into `$CARGO_INSTALL_ROOT`.
./nix/scripts/setup_prereqs.sh
```

#### 2.2 Run .vscode/setup_env.sh
This will ensure your build and dev envs can find everything they need

#### 2.3 Initializing/Configuring the Environment (using direnv,
which activates the environment automatically when you `cd` into the repo)

From the psibase repo root:

```bash
cat >> .vscode/.envrc <<'EOF'
# launch nix env via flake
use flake .
# set IP for Launch/Continue scripts
HOST_IP=127.0.0.1
# git credentials configured in .git/config
#[credential]
#    helper = 
#    helper = store --file=/home/mike/.git-credentials-work
EOF
direnv allow
```

#### 2.4 extensions
Copy nix/docs/extensions.json.example to .vscode/extensions.json to pick up the standard dev extensions.

### 3. Verify environment (optional)

```bash
./nix/scripts/verify_env.sh
```

Checks compilers, Rust, Node, WASI SDK, ICU paths, and cargo tools.
All should be green checkmarks. Yellow warnings are likely OK, but rare. Red Xs mean something's wrong.

### 4. Build psibase
#### Clean build required on first run (or after shell changes):
You should, at this point, see the standard tasks.json buttons. Manually wipe your build dir, then click the Build button (manual steps below)

```bash
rm -rf build && mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=psidk ..
cmake --build . -j$(nproc)
```

### 5. Launch a chain
#### Launch
You should, at this point, see the standard tasks.json buttons. Press Launch to launch a change (manual hacky command below).

Within the nix shell, replace the PROJECT_ROOT below with your repo root path:
```bash
PROJECT_ROOT="/home/mike/repos/fractally/psibase" PSIBASE_ADMIN_IP=127.0.0.1 psinode "$PROJECT_ROOT/db" -p myprod -l 7777
```

#### Boot
Boot as you normally would from the cli or use the provided x-admin link and boot with the UI.

## Optional: HTTPS and SoftHSM
SKIP if you're doing a quick build and http test.

- **HTTPS**: The shell includes `mkcert`. Run `mkcert -install`, create certs, and set `VITE_SECURE_LOCAL_DEV=true` and `VITE_SECURE_PATH_TO_CERTS` if needed.
- **SoftHSM2**: `softhsm2-util --init-token --slot 0 --label "psibase SoftHSM" --pin "Ch4ng#Me!" --so-pin "Ch4ng#Me!"`

## IDE (VS Code / Cursor)

- Use the **direnv** extension so the Nix environment is picked up automatically, or
- Start the editor from inside the shell: `nix develop` then `cursor .` (or `code .`).

Recommended extensions: clangd, rust-analyzer, wit-idl, ESLint, Prettier, direnv.

## Environment variables set by the shell

| Variable | Description |
|----------|-------------|
| `WASI_SDK_PREFIX` | Path to WASI SDK |
| `WASI_SYSROOT` | WASI sysroot |
| `CC` / `CXX` | Clang paths |
| `LIBCLANG_PATH` | For rust-analyzer |
| `RUST_SRC_PATH` | For rust-analyzer |
| `IN_NIX_SHELL` | Set to `1` in the shell |

## Troubleshooting

- **Cargo tools fail to install**: Use the pinned versions and run `./nix/scripts/setup_prereqs.sh` from inside `nix develop`.
- **"command not found"**: Ensure you're in a `nix develop` shell or that direnv has run (`direnv allow`).
- **ICU / ABI errors**: Ensure you're in the Nix shell and do a clean build (`rm -rf build && mkdir build`). The flake sets `ICU_ROOT` and `CMAKE_IGNORE_PATH` to avoid picking up system ICU from `/usr/lib`.
- **Rust analyzer not finding deps**: Run the editor from inside the Nix shell or use the direnv extension.

## Updating the environment

```bash
# NOTE: the cargo/rust versions we needed to pin are pineed; so you can update freely without worrying about those.
nix flake update
nix develop
```

## Files

- `flake.nix` / `flake.lock` — Nix flake at repo root
- `nix/rust-toolchain.toml` — Rust version and targets
- `nix/scripts/setup_prereqs.sh` — One-time cargo tool install
- `nix/scripts/verify_env.sh` — Environment verification

## Relationship to Docker

Docker (psibase-contributor) remains a supported path. Nix is an **additional** option for Linux: one clone of psibase, then `nix develop` and build.
