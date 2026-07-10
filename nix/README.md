Nix-Based Development Environment for Psibase (Linux)

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

## 3. Build and Launch psibase
Build or Launch with the tasks.json buttons or by running the same command at the nix shell

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

- **First nix build fails**: Try wiping your build/ dir to regenerate caches
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
- `nix/rust-toolchain.toml` — Rust version and targets

# Relationship to Docker

Docker (psibase-contributor) remains a supported path. Nix is an **additional** option for Linux: one clone of psibase, then `nix develop` and build.
