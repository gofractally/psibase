{
  description = "Psibase dev environment";

  inputs = {
    # nixos-25.05 provides Boost 1.88 (matches psibase-contributor). Was previously
    # pinned to 24.05 for GCC 13 / libstdc++ compatibility with Catch2.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";

    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Fragile cargo tools, each pinned to the exact nixpkgs revision that packages
    # the required version (chosen for Rust 1.86.0 / psibase compatibility). These
    # MUST stay at their pinned versions, so they deliberately do NOT `follow`
    # nixpkgs — the frozen revision is the whole point. No single nixpkgs rev
    # carries all three versions at once, hence one input per tool.
    #   cargo-component 0.15.0
    nixpkgs-cargo-component.url = "github:NixOS/nixpkgs/b1e27a8646234340ea2c8b4e3f73e9e2b2bca505";
    #   cargo-generate 0.23.5
    nixpkgs-cargo-generate.url = "github:NixOS/nixpkgs/1d0bb7b61b251a261b0963aacf4b141e770a4f1d";
    #   cargo-edit 0.13.0
    nixpkgs-cargo-edit.url = "github:NixOS/nixpkgs/30bae272ac6c85ea58c05501e3a8cb41b8dcfa0a";
  };

  outputs = { self, nixpkgs, flake-utils, fenix, nixpkgs-cargo-component, nixpkgs-cargo-generate, nixpkgs-cargo-edit }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        # Fragile cargo tools, each from its own pinned nixpkgs revision (see inputs).
        # cargo-edit ships the cargo-set-version binary used by the build.
        cargoComponent = (import nixpkgs-cargo-component { inherit system; }).cargo-component;
        cargoGenerate = (import nixpkgs-cargo-generate { inherit system; }).cargo-generate;
        cargoEdit = (import nixpkgs-cargo-edit { inherit system; }).cargo-edit;

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

        # nixos-25.05 ships GCC 14 libstdc++; Catch2 + clang need GCC 13 headers.
        gcc13 = pkgs.gcc13;
        gccTriple =
          if system == "aarch64-linux" then "aarch64-unknown-linux-gnu"
          else "x86_64-unknown-linux-gnu";

        boost = pkgs.boost188.override {
          enableStatic = true;
          enableShared = true;
        };

        # Nix splits Boost static libs (out) from CMake config (dev). CMake's
        # imported targets point at dev/lib, which has no .a files. Merge both
        # outputs so find_package(Boost CONFIG) resolves libraries correctly.
        boostForCMake = pkgs.symlinkJoin {
          name = "boost188-cmake";
          paths = [ boost boost.dev ];
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
          gcc13
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
          nixDevelopBash
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
          ICU_LIBRARY_DIR = "${pkgs.icu}/lib";
          CMAKE_IGNORE_PATH = "/usr/lib:/usr/lib64";
          CMAKE_SYSTEM_IGNORE_PATH = "/usr/lib:/usr/lib64";
          RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";

          shellHook = ''
            export NIX_SHELL_DEPTH=$(("''${NIX_SHELL_DEPTH:-0}" + 1))
            export IN_NIX_SHELL=1
            # nix develop may run this hook under non-interactive bash (no progcomp/complete).
            # Point SHELL at bashInteractive so subshells and IDE terminals get a usable bash.
            export SHELL="${pkgs.bashInteractive}/bin/bash"

            export CC="${llvmPackages.clang}/bin/clang"
            export CXX="${llvmPackages.clang}/bin/clang++"
            export PATH="$PATH:${wasiSdk}/bin"

            unset NIX_LDFLAGS
            unset NIX_LDFLAGS_BEFORE
            unset NIX_CFLAGS_LINK
            unset LD_LIBRARY_PATH
            export ICU_LIBRARY_DIR="${pkgs.icu}/lib"
            export CMAKE_PREFIX_PATH="${boostForCMake}''${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}"
            export BOOST_LIBRARYDIR="${boost}/lib"
            export BOOST_INCLUDEDIR="${boost.dev}/include"
            export NIX_CFLAGS_COMPILE="-nostdinc++ -isystem ${gcc13.cc}/include/c++/${gcc13.cc.version} -isystem ${gcc13.cc}/include/c++/${gcc13.cc.version}/${gccTriple} -isystem ${pkgs.openssl.dev}/include"
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
              echo "  Clang: $(clang --version | head -1)"
              echo "  Rust:  $(rustc --version)"
              echo "  Node:  $(node --version)"
              echo "  Yarn:  $(yarn --version)"
              echo "  WASI SDK: ${wasiSdk}"
              echo "  cargo-component: $(cargo-component --version 2>/dev/null | head -1)"
              echo "  cargo-generate:  $(cargo-generate --version 2>/dev/null | head -1)"
              echo ""
              echo "To build psibase (clean build required on first run):"
              echo "  rm -rf build && mkdir build && cd build"
              echo "cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_BUILD_TYPE=Release -DBUILD_DEBUG_WASM=ON -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_INSTALL_PREFIX="psidk" .."
              echo "  cmake --build . -j\$(nproc)"
              echo ""
            fi
          '';
        };

        packages.wasi-sdk = wasiSdk;
      }
    );
}
