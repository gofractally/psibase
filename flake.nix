{
  description = "Psibase dev environment";

  inputs = {
    # Pin to nixos-24.05 for GCC 13 compatibility (GCC 15 in unstable has libstdc++ issues with Catch2)
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.05";
    flake-utils.url = "github:numtide/flake-utils";

    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, fenix }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        # Rust 1.86.0 toolchain with WASM targets (see nix/rust-toolchain.toml)
        rustToolchain = fenix.packages.${system}.fromToolchainFile {
          file = ./nix/rust-toolchain.toml;
          sha256 = "sha256-X/4ZBHO3iW0fOenQ3foEvscgAPJYl2abspaBThDOukI=";
        };

        # WASI SDK - fetched from GitHub releases (version 29 matches psibase's CMakeLists.txt)
        # On Linux, binaries need patching to work on NixOS (they're built for generic Linux)
        wasiSdk = pkgs.stdenv.mkDerivation rec {
          pname = "wasi-sdk";
          version = "29";

          src =
            let
              base = "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${version}";
            in
            if pkgs.stdenv.hostPlatform.isAarch64 then
              pkgs.fetchurl {
                url = "${base}/wasi-sdk-${version}.0-arm64-linux.tar.gz";
                sha256 = "sha256-BSrXczl9yeWqmftM/vaUF15rHoG7KtHTyOez/IFEG3w=";
              }
            else
              pkgs.fetchurl {
                url = "${base}/wasi-sdk-${version}.0-x86_64-linux.tar.gz";
                sha256 = "sha256-h9HRooedE5zcYkuWjvrT1Kl7gHjN/5XmOsiOyv0aAXE=";
              };

          nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
            pkgs.autoPatchelfHook
          ];

          buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
            pkgs.stdenv.cc.cc.lib
            pkgs.zlib
          ];

          dontBuild = true;
          dontConfigure = true;

          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r * $out/
            runHook postInstall
          '';
        };

        llvmPackages = pkgs.llvmPackages_18;

        boost = pkgs.boost183.override {
          enableStatic = true;
          enableShared = true;
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
            makeWrapper ${pkgs.nodejs_20}/bin/node $out/bin/yarn \
              --add-flags "$out/lib/yarn/packages/yarnpkg-cli/bin/yarn.js"
            runHook postInstall
          '';
        };

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
          boost
          openssl
          zlib
          zstd
          rustToolchain
          binaryen
          wabt
          wasm-pack
          wasm-tools
          nodejs_20
          yarnBerry
          nodePackages.eslint
          nodePackages.prettier
          python3
          python3Packages.websockets
          python3Packages.requests
          git
          curl
          wget
          jq
          xxd
          unzip
          zstd
          icu
          direnv
          mkcert
          softhsm
          mdbook
          mdbook-mermaid
          mdbook-linkcheck
          cacert
          # Shell and editor UX in nix develop
          vim
          bashInteractive
          bash-completion
        ];

        linuxPackages = with pkgs; [
          iproute2
          strace
          gdb
        ];

      in
      {
        devShells.default = pkgs.mkShell {
          name = "psibase-dev";

          packages = commonPackages ++ linuxPackages;

          WASI_SDK_PREFIX = "${wasiSdk}";
          WASI_SYSROOT = "${wasiSdk}/share/wasi-sysroot";
          WASI_SDK_AR = "${wasiSdk}/bin/ar";
          WASI_SDK_RANLIB = "${wasiSdk}/bin/ranlib";

          CC = "${llvmPackages.clang}/bin/clang";
          CXX = "${llvmPackages.clang}/bin/clang++";

          LIBCLANG_PATH = "${llvmPackages.libclang.lib}/lib";
          ICU_ROOT = "${pkgs.icu}";
          CMAKE_IGNORE_PATH = "/usr/lib:/usr/lib64";
          CMAKE_SYSTEM_IGNORE_PATH = "/usr/lib:/usr/lib64";
          RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";

          shellHook = ''
            export NIX_SHELL_DEPTH=$(("''${NIX_SHELL_DEPTH:-0}" + 1))
            export IN_NIX_SHELL=1

            export CC="${llvmPackages.clang}/bin/clang"
            export CXX="${llvmPackages.clang}/bin/clang++"
            export PATH="$PATH:${wasiSdk}/bin"

            unset NIX_LDFLAGS
            unset NIX_LDFLAGS_BEFORE
            unset NIX_CFLAGS_LINK
            unset LD_LIBRARY_PATH
            export NIX_LDFLAGS="-L${pkgs.icu}/lib"
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

            alias ll="ls -alF"
            parse_git_branch() {
              git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/ (\1)/'
            }
            export PS1="🧱🔧 \[\033[01;32m\]psibase-nix\[\033[00m\]:\[\033[01;34m\]\w\[\033[32m\]\$(parse_git_branch)\[\033[00m\]\$ "

            if [ -n "$BASH_VERSION" ]; then
              if [[ -r ${pkgs.bash-completion}/share/bash-completion/bash_completion ]]; then
                source ${pkgs.bash-completion}/share/bash-completion/bash_completion
              fi
              # Init file for inner bash (e.g. Cursor terminal) so vi mode and completions
              # are applied even when bash is started with custom args.
              _nix_bash_init="$PSIBASE_ROOT/nix/.nix-develop-bashrc"
              if [[ -d "$PSIBASE_ROOT/nix" ]] && [[ -w "$PSIBASE_ROOT/nix" ]]; then
                cat > "$_nix_bash_init" << 'NIX_BASH_INIT_EOF'
            set -o vi
            if [[ -n "$BASH_VERSION" ]] && shopt -s progcomp 2>/dev/null; then
              [[ -r __BASH_COMPLETION__ ]] && source __BASH_COMPLETION__
            fi
            [[ -f "$HOME/.bashrc" ]] && . "$HOME/.bashrc"
            NIX_BASH_INIT_EOF
                sed -i "s|__BASH_COMPLETION__|${pkgs.bash-completion}/share/bash-completion/bash_completion|g" "$_nix_bash_init"
              fi
              if command -v direnv &> /dev/null; then
                eval "$(direnv hook bash)"
              fi
            fi

            export CARGO_INSTALL_ROOT="$HOME/.cache/psibase-nix-cargo"
            export PATH="$CARGO_INSTALL_ROOT/bin:$PATH:$HOME/.cargo/bin"

            _check_cargo_tools() {
              local cargo_bin="$CARGO_INSTALL_ROOT/bin"
              local missing=""
              [ -x "$cargo_bin/cargo-component" ] || missing="$missing cargo-component"
              [ -x "$cargo_bin/cargo-generate" ] || missing="$missing cargo-generate"
              [ -x "$cargo_bin/cargo-set-version" ] || missing="$missing cargo-set-version"
              if [ -n "$missing" ]; then
                echo ""
                echo "Note: Some cargo tools need to be installed (one-time setup)."
                echo "Missing:$missing"
                echo "Run: ./nix/scripts/setup_prereqs.sh"
                echo ""
              fi
            }

            if [ "$NIX_SHELL_DEPTH" -eq 1 ]; then
              echo ""
              echo "Psibase Nix Development Environment"
              echo "  Clang: $(clang --version | head -1)"
              echo "  Rust:  $(rustc --version)"
              echo "  Node:  $(node --version)"
              echo "  Yarn:  $(yarn --version)"
              echo "  WASI SDK: ${wasiSdk}"
              echo ""
              _check_cargo_tools
              echo "To build psibase (clean build required on first run):"
              echo "  rm -rf build && mkdir build && cd build"
              echo "  cmake .. -DCMAKE_BUILD_TYPE=Release"
              echo "  cmake --build . -j\$(nproc)"
              echo ""
            fi
          '';
        };

        packages.wasi-sdk = wasiSdk;
      }
    );
}
