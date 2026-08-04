# Contributor `nix develop` shell (full monorepo toolchain).
# Only evaluated for `devShells.default` — not for packages.psibase / nixosModules.
{
  pkgs,
  system,
  fenix,
  wasiSdk,
  nixpkgs-cargo-component,
  nixpkgs-cargo-generate,
  nixpkgs-cursor-cli,
  nixpkgs-mdbook,
  nixpkgs-mdbook-mermaid,
  nixpkgs-mdbook-plugins,
  nixpkgs-mdbook-linkcheck,
  nixpkgs-mdbook-pagetoc,
  nixpkgs-nodejs,
}:
let
  # Fragile cargo tools, each from its own pinned nixpkgs revision (see flake inputs).
  # cargo-edit ships the cargo-set-version binary used by the build.
  cargoComponent = (import nixpkgs-cargo-component { inherit system; }).cargo-component;
  cargoToolsPkgs = import nixpkgs-cargo-generate { inherit system; };
  cargoGenerate = cargoToolsPkgs.cargo-generate;
  cargoEdit = cargoToolsPkgs.cargo-edit;
  cursorCli = (import nixpkgs-cursor-cli {
    inherit system;
    config.allowUnfree = true;
  }).cursor-cli;

  mdbook = (import nixpkgs-mdbook { inherit system; }).mdbook;
  mdbookMermaid = (import nixpkgs-mdbook-mermaid { inherit system; }).mdbook-mermaid;
  mdbookPlugins = (import nixpkgs-mdbook-plugins { inherit system; }).mdbook-plugins;
  mdbookLinkcheck = (import nixpkgs-mdbook-linkcheck { inherit system; }).mdbook-linkcheck;
  mdbookPagetoc = (import nixpkgs-mdbook-pagetoc { inherit system; }).mdbook-pagetoc;
  wasmPack = (import nixpkgs-mdbook { inherit system; }).wasm-pack;
  nodejs20 = (import nixpkgs-nodejs { inherit system; }).nodejs_20;

  # Rust 1.86.0 toolchain with WASM targets (see nix/rust-toolchain.toml)
  rustToolchain = fenix.packages.${system}.fromToolchainFile {
    file = ../rust-toolchain.toml;
    sha256 = "sha256-X/4ZBHO3iW0fOenQ3foEvscgAPJYl2abspaBThDOukI=";
  };

  llvmPackages = pkgs.llvmPackages_18;

  boost = pkgs.boost188.override {
    enableStatic = true;
    enableShared = true;
  };

  # Nix splits Boost static libs (out) from CMake config (dev). CMake's
  # imported targets point at dev/lib, which has no .a files. Merge both
  # outputs so find_package(Boost CONFIG) resolves libraries correctly.
  boostForCMake = pkgs.symlinkJoin {
    name = "boost188-cmake";
    paths = [
      boost
      boost.dev
    ];
  };

  # Bash init for inner shells (e.g. Cursor/VS Code terminal via psibase-nix-bash).
  nixDevelopBashrc = pkgs.writeText "nix-develop-bashrc" ''
    set -o vi
    if [[ -n "$BASH_VERSION" ]] && shopt -s progcomp 2>/dev/null; then
      [[ -r ${pkgs.bash-completion}/share/bash-completion/bash_completion ]] && source ${pkgs.bash-completion}/share/bash-completion/bash_completion
    fi
    [[ -f "$HOME/.bashrc" ]] && . "$HOME/.bashrc"
  '';

  nixDevelopBash = pkgs.writeShellScriptBin "psibase-nix-bash" ''
    exec ${pkgs.bashInteractive}/bin/bash --init-file ${nixDevelopBashrc} "$@"
  '';

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

  # wasm-tools: unpinned from nixpkgs (floats with nixos-26.05), like contributor's
  # unpinned `cargo install wasm-tools`.
  wasmTools = pkgs.wasm-tools;

  commonPackages = with pkgs; [
    cmake
    ninja
    gnumake
    autoconf
    automake
    libtool
    pkg-config
    ccache
    sccache
    llvmPackages.clang
    llvmPackages.llvm
    llvmPackages.lld
    llvmPackages.libclang
    llvmPackages.clang-tools
    boostForCMake
    openssl
    zlib
    zstd
    rustToolchain
    cargoComponent
    cargoGenerate
    cargoEdit
    binaryen
    wabt
    wasmPack
    wasmTools
    nodejs20
    yarnBerry
    eslint
    prettier
    python3
    python3Packages.websockets
    python3Packages.requests
    git
    gh
    curl
    wget
    jq
    xxd
    unzip
    icu
    direnv
    mkcert
    softhsm
    mdbook
    mdbookMermaid
    mdbookPagetoc
    mdbookPlugins
    mdbookLinkcheck
    cacert
    # Shell and editor UX in nix develop
    vim
    bashInteractive
    bash-completion
    nixDevelopBash
    cursorCli
  ];

  linuxPackages = with pkgs; [
    iproute2
    strace
    gdb
  ];
in
pkgs.mkShell {
  name = "psibase-dev";

  packages = commonPackages ++ linuxPackages;

  WASI_SDK_PREFIX = "${wasiSdk}";
  WASI_SDK_AR = "${wasiSdk}/bin/ar";
  WASI_SDK_RANLIB = "${wasiSdk}/bin/ranlib";

  LIBCLANG_PATH = "${llvmPackages.libclang.lib}/lib";
  ICU_ROOT = "${pkgs.icu}";
  ICU_LIBRARY_DIR = "${pkgs.icu}/lib";
  CMAKE_IGNORE_PATH = "/usr/lib:/usr/lib64";
  CMAKE_SYSTEM_IGNORE_PATH = "/usr/lib:/usr/lib64";
  RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";
  # Loopback admin IP for Launch/Continue tasks and launch.sh (set automatically in psibase-contributor).
  HOST_IP = "127.0.0.1";

  shellHook = ''
    export NIX_SHELL_DEPTH=$(("''${NIX_SHELL_DEPTH:-0}" + 1))
    export IN_NIX_SHELL=1
    # nix develop may run this hook under non-interactive bash (no progcomp/complete).
    # Point SHELL at bashInteractive so subshells and IDE terminals get a usable bash.
    export SHELL="${pkgs.bashInteractive}/bin/bash"

    export PATH="$PATH:${wasiSdk}/bin"

    unset NIX_LDFLAGS
    unset NIX_LDFLAGS_BEFORE
    unset NIX_CFLAGS_LINK
    unset LD_LIBRARY_PATH
    export ICU_LIBRARY_DIR="${pkgs.icu}/lib"
    export CMAKE_PREFIX_PATH="${boostForCMake}''${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}"
    export BOOST_LIBRARYDIR="${boost}/lib"
    export BOOST_INCLUDEDIR="${boost.dev}/include"
    export NIX_LDFLAGS="-L${pkgs.icu}/lib -L${pkgs.openssl.out}/lib"
    export LIBRARY_PATH="${pkgs.icu}/lib''${LIBRARY_PATH:+:$LIBRARY_PATH}"
    export CMAKE_LIBRARY_PATH="${pkgs.icu}/lib''${CMAKE_LIBRARY_PATH:+:$CMAKE_LIBRARY_PATH}"

    # Discover psibase repo root and add built binaries to PATH so
    # tools like psinode / psibase are runnable from anywhere.
    if command -v git >/dev/null 2>&1; then
      PSIBASE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    else
      PSIBASE_ROOT="$(pwd)"
    fi
    export PSIBASE_ROOT
    export PATH="$PSIBASE_ROOT/build/psidk/bin:$PATH"
    export PATH="$PSIBASE_ROOT/build/rust/release:$PATH"
    export PATH="$PSIBASE_ROOT/build:$PATH"

    export CCACHE_DIR="''${CCACHE_DIR:-$HOME/.cache/ccache}"
    export SCCACHE_DIR="''${SCCACHE_DIR:-$HOME/.cache/sccache}"
    export CARGO_COMPONENT_CACHE_DIR="''${CARGO_COMPONENT_CACHE_DIR:-$HOME/.cache/cargo-component}"
    export WASM_PACK_CACHE="''${WASM_PACK_CACHE:-$HOME/.cache/wasm-pack}"
    # nix-shell puts TMPDIR on /tmp, often a separate mount from $HOME. cargo-component
    # atomically renames temp outputs into the build tree, which fails across devices.
    export TMPDIR="$HOME/.cache/psibase-nix/tmp"
    mkdir -p "$TMPDIR"

    alias ll="ls -alF"
    parse_git_branch() {
      git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/ (\1)/'
    }
    export PS1="🔧 \[\033[01;32m\]psibase-nix\[\033[00m\]:\[\033[01;34m\]\w\[\033[32m\]\$(parse_git_branch)\[\033[00m\]\$ "

    if [ -n "$BASH_VERSION" ]; then
      if shopt -s progcomp 2>/dev/null && [[ -r ${pkgs.bash-completion}/share/bash-completion/bash_completion ]]; then
        source ${pkgs.bash-completion}/share/bash-completion/bash_completion
      fi
      export NIX_BASH_INIT="${nixDevelopBashrc}"
      if command -v direnv &> /dev/null; then
        eval "$(direnv hook bash)"
      fi
    fi

    # cargo-component / cargo-generate / cargo-set-version are provided by the
    # flake at pinned versions; keep any user-installed cargo tools available too.
    export PATH="$PATH:$HOME/.cargo/bin"

    if [ "$NIX_SHELL_DEPTH" -eq 1 ]; then
      echo ""
      echo "Psibase Nix Development Environment"
      echo "  GCC:   $(gcc --version | head -1)"
      echo "  Clang: $(clang --version | head -1)  (WASM / clangd)"
      echo "  Rust:  $(rustc --version)"
      echo "  Node:  $(node --version)"
      echo "  Yarn:  $(yarn --version)"
      echo "  WASI SDK: ${wasiSdk}"
      echo "  cargo-component: $(cargo-component --version 2>/dev/null | head -1)"
      echo "  cargo-generate:  $(cargo-generate --version 2>/dev/null | head -1)"
      echo "  cargo-edit:      0.13.7 (cargo-set-version)"
      echo "  cursor-agent:    $(cursor-agent --version 2>/dev/null | head -1)"
      echo ""
    fi
  '';
}
