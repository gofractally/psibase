export NIX_SHELL_DEPTH=$(("${NIX_SHELL_DEPTH:-0}" + 1))
export IN_NIX_SHELL=1
export SHELL="@bashInteractive@/bin/bash"

# psidk tools first — never monorepo build/ paths.
export PATH="@psidk@/bin:$PATH:@wasiSdk@/bin"
# crates.io cargo-psibase (when not in the release tarball) lands here.
export PATH="$PATH:$HOME/.cargo/bin"

export PSIBASE_DATADIR="@psidk@/share/psibase"
export PSIBASE_PACKAGE_TEMPLATES="@packageTemplates@"
export PSIBASE_CRATE_VERSION="@psibaseCrateVersion@"
# Keep schema gen on the SDK train (contributor build/ psitest is often newer).
export CARGO_PSIBASE_PSITEST="@psidk@/bin/psitest"

export CARGO_COMPONENT_CACHE_DIR="${CARGO_COMPONENT_CACHE_DIR:-$HOME/.cache/cargo-component}"
export WASM_PACK_CACHE="${WASM_PACK_CACHE:-$HOME/.cache/wasm-pack}"
# Keep cargo-component temp + build tree on the same filesystem.
export TMPDIR="$HOME/.cache/psibase-nix/tmp"
mkdir -p "$TMPDIR"

alias ll="ls -alF"
parse_git_branch() {
  git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/ (\1)/'
}
export PS1="📦 \[\033[01;32m\]psibase-sdk\[\033[00m\]:\[\033[01;34m\]\w\[\033[32m\]\$(parse_git_branch)\[\033[00m\]\$ "

if [ -n "$BASH_VERSION" ]; then
  if shopt -s progcomp 2>/dev/null && [[ -r @bashCompletion@/share/bash-completion/bash_completion ]]; then
    source @bashCompletion@/share/bash-completion/bash_completion
  fi
  if command -v direnv &> /dev/null; then
    eval "$(direnv hook bash)"
  fi
fi

# Native Rust must use the Nix gcc wrapper (not rust-lld via `cc`), or
# RUNPATH is missing and cargo-psibase's build script cannot find libstdc++
# (wasm-opt/binaryen). Same fix as the monorepo contributor shell.
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER="@cc@/bin/gcc"
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="@cc@/bin/gcc"
# Host imports stay undefined until cargo-psibase polyfills; rust-lld 1.98+
# rejects them without this.
export CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS="${CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS:--C link-arg=--allow-undefined}"

# Prefer tarball cargo-psibase when the Release ships it; otherwise install
# the crates.io build matching nix/release.nix cargoPsibaseVersion.
_psibase_sdk_ensure_cargo_psibase() {
  local want="@cargoPsibaseVersion@"
  local have=""
  if [ -x "@psidk@/bin/cargo-psibase" ]; then
    return 0
  fi
  if command -v cargo-psibase >/dev/null 2>&1; then
    have="$(cargo-psibase --version 2>/dev/null | awk '{print $2}')"
    if [ "$have" = "$want" ]; then
      return 0
    fi
  fi
  echo "Installing cargo-psibase $want from crates.io (matches SDK pin)…"
  cargo install cargo-psibase --version "$want" --locked --force
}
_psibase_sdk_ensure_cargo_psibase

if [ "$NIX_SHELL_DEPTH" -eq 1 ]; then
  echo ""
  echo "Psibase Package SDK (nix develop .#sdk)"
  echo "  Rust:     $(rustc --version)"
  echo "  Node:     $(node --version)"
  echo "  Yarn:     $(yarn --version)"
  echo "  WASI SDK: @wasiSdk@"
  echo "  psibase:  $(psibase --version 2>/dev/null | head -1)"
  echo "  cargo-psibase: $(command -v cargo-psibase) ($(cargo-psibase --version 2>/dev/null || echo '?'))"
  echo "  PSIBASE_DATADIR=$PSIBASE_DATADIR"
  echo ""
  echo "  Local chain:  psiapp chain up|down|status"
  echo "  New app:      psiapp new <name>   (cargo-generate → packages/<App>)"
  echo "  Workspace:    nix flake init -t …#package   (see nix/sdk/README.md)"
  echo "  Docs:         nix/sdk/README.md"
  echo ""
fi
