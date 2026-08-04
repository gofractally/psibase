# Package-developer `nix develop .#sdk` shell (Rust out-of-tree packages).
# Does not assume a psibase monorepo checkout or local build/ tree.
# Contributor-only inputs (mdbook, cursor-cli, …) are not imported here.
{
  pkgs,
  system,
  fenix,
  wasiSdk,
  nixpkgs-cargo-component,
  nixpkgs-cargo-generate,
  nixpkgs-nodejs,
  # packages.psidk
  psidk,
}:
let
  cargoComponent = (import nixpkgs-cargo-component { inherit system; }).cargo-component;
  cargoToolsPkgs = import nixpkgs-cargo-generate { inherit system; };
  cargoGenerate = cargoToolsPkgs.cargo-generate;
  cargoEdit = cargoToolsPkgs.cargo-edit;
  nodejs20 = (import nixpkgs-nodejs { inherit system; }).nodejs_20;

  rustToolchain = fenix.packages.${system}.fromToolchainFile {
    file = ../rust-toolchain.toml;
    sha256 = "sha256-X/4ZBHO3iW0fOenQ3foEvscgAPJYl2abspaBThDOukI=";
  };

  yarnBerry = pkgs.stdenv.mkDerivation rec {
    pname = "yarn-berry";
    version = "4.9.1";

    src = pkgs.fetchFromGitHub {
      owner = "yarnpkg";
      repo = "berry";
      rev = "@yarnpkg/cli/${version}";
      sha256 = "sha256-znxB827TFLAEfCeHrwBsmRlkZz1LVWsBFhjZANiIW/4=";
    };

    nativeBuildInputs = [ pkgs.makeWrapper ];

    dontBuild = true;
    dontConfigure = true;

    installPhase = ''
      runHook preInstall
      mkdir -p $out/lib/yarn $out/bin
      cp -r . $out/lib/yarn/
      makeWrapper ${nodejs20}/bin/node $out/bin/yarn \
        --add-flags "$out/lib/yarn/packages/yarnpkg-cli/bin/yarn.js"
      runHook postInstall
    '';
  };

  # Match nix/release.nix / published crates until the tarball ships cargo-psibase.
  cargoPsibaseCrateVersion = "0.23.0";

  sdkPackages = with pkgs; [
    psidk
    rustToolchain
    cargoComponent
    cargoGenerate
    cargoEdit
    binaryen
    wabt
    wasm-pack
    wasm-tools
    nodejs20
    yarnBerry
    eslint
    prettier
    python3
    python3Packages.websockets
    python3Packages.requests
    git
    curl
    jq
    unzip
    cacert
    direnv
    mkcert
    softhsm
    vim
    bashInteractive
    bash-completion
  ];
in
pkgs.mkShell {
  name = "psibase-sdk";

  packages = sdkPackages;

  WASI_SDK_PREFIX = "${wasiSdk}";
  WASI_SDK_AR = "${wasiSdk}/bin/ar";
  WASI_SDK_RANLIB = "${wasiSdk}/bin/ranlib";

  RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";
  HOST_IP = "127.0.0.1";

  # Explicit data root for tools that honor the env override; binaries also
  # resolve via $out/bin → ../share/psibase from the store path.
  PSIBASE_DATADIR = "${psidk}/share/psibase";

  shellHook = ''
    export NIX_SHELL_DEPTH=$(("''${NIX_SHELL_DEPTH:-0}" + 1))
    export IN_NIX_SHELL=1
    export SHELL="${pkgs.bashInteractive}/bin/bash"

    # psidk tools first — never monorepo build/ paths.
    export PATH="${psidk}/bin:$PATH:${wasiSdk}/bin"
    # Interim cargo-psibase from `cargo install` lands here (see below).
    export PATH="$PATH:$HOME/.cargo/bin"

    export PSIBASE_DATADIR="${psidk}/share/psibase"

    export CARGO_COMPONENT_CACHE_DIR="''${CARGO_COMPONENT_CACHE_DIR:-$HOME/.cache/cargo-component}"
    export WASM_PACK_CACHE="''${WASM_PACK_CACHE:-$HOME/.cache/wasm-pack}"
    # Keep cargo-component temp + build tree on the same filesystem.
    export TMPDIR="$HOME/.cache/psibase-nix/tmp"
    mkdir -p "$TMPDIR"

    alias ll="ls -alF"
    parse_git_branch() {
      git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/ (\1)/'
    }
    export PS1="📦 \[\033[01;32m\]psibase-sdk\[\033[00m\]:\[\033[01;34m\]\w\[\033[32m\]\$(parse_git_branch)\[\033[00m\]\$ "

    if [ -n "$BASH_VERSION" ]; then
      if shopt -s progcomp 2>/dev/null && [[ -r ${pkgs.bash-completion}/share/bash-completion/bash_completion ]]; then
        source ${pkgs.bash-completion}/share/bash-completion/bash_completion
      fi
      if command -v direnv &> /dev/null; then
        eval "$(direnv hook bash)"
      fi
    fi

    # Interim: release tarballs through v0.24.0-pre omit bin/cargo-psibase.
    # Once a tagged Release ships it in psidk, this block becomes a no-op.
    # Opt-in auto-install (network): PSIBASE_SDK_INSTALL_CARGO_PSIBASE=1
    if ! command -v cargo-psibase >/dev/null 2>&1; then
      if [ "''${PSIBASE_SDK_INSTALL_CARGO_PSIBASE:-}" = "1" ]; then
        echo "cargo-psibase not in psidk; installing ${cargoPsibaseCrateVersion} via cargo (interim)…"
        cargo install cargo-psibase --version ${cargoPsibaseCrateVersion} --locked \
          || echo "warning: cargo install cargo-psibase failed"
      fi
    fi

    if [ "$NIX_SHELL_DEPTH" -eq 1 ]; then
      echo ""
      echo "Psibase Package SDK (nix develop .#sdk)"
      echo "  Rust:     $(rustc --version)"
      echo "  Node:     $(node --version)"
      echo "  Yarn:     $(yarn --version)"
      echo "  WASI SDK: ${wasiSdk}"
      echo "  psibase:  $(psibase --version 2>/dev/null | head -1)"
      if command -v cargo-psibase >/dev/null 2>&1; then
        echo "  cargo-psibase: $(command -v cargo-psibase)"
      else
        echo "  cargo-psibase: MISSING (not in release tarball yet)"
        echo "    fix:  cargo install cargo-psibase --version ${cargoPsibaseCrateVersion} --locked"
        echo "    or:   PSIBASE_SDK_INSTALL_CARGO_PSIBASE=1 nix develop .#sdk"
      fi
      echo "  PSIBASE_DATADIR=$PSIBASE_DATADIR"
      echo ""
      echo "  No monorepo build/ on PATH. Local chain helper: Phase 4."
      echo "  Docs: nix/sdk/README.md"
      echo ""
    fi
  '';
}
