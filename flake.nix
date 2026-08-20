{
  description = "Psibase Nix flake (dev shell + NixOS module)";

  inputs = {
    # Package versions are intended to match `psibase-contributor`. Places where that's
    # impossible for nix packaging logical reason (packages not available where we need
    # them or the set of packages we need not available from the same place), we diverge.
    # Each divergence is called out and re-synced with `psibase-contributor` when possible.

    # --- Shared (deploy package / module / any system output) ---
    # nixos-26.05 provides Boost 1.88. Native C++ uses stdenv GCC.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";

    # --- Contributor shell only (imported from nix/dev/shell.nix; not used by
    # packages.psibase or nixosModules.psibase). ---
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Fragile cargo tools, each pinned to the exact nixpkgs revision that packages
    # the required version (chosen for Rust 1.86.0 / psibase compatibility). These
    # MUST stay at their pinned versions, so they deliberately do NOT `follow`
    # nixpkgs — the frozen revision is the whole point. No single nixpkgs rev
    # carries all required versions at once, hence one input per tool (cargo-generate
    # and cargo-edit share a rev that packages both 0.23.5 and 0.13.7).
    #   cargo-component 0.15.0
    nixpkgs-cargo-component.url = "github:NixOS/nixpkgs/b1e27a8646234340ea2c8b4e3f73e9e2b2bca505";
    #   cargo-generate 0.23.5, cargo-edit 0.13.7 (same nixpkgs rev)
    nixpkgs-cargo-generate.url = "github:NixOS/nixpkgs/1d0bb7b61b251a261b0963aacf4b141e770a4f1d";
    #   cursor-cli (cursor-agent; not in nixos-26.05)
    nixpkgs-cursor-cli.url = "github:NixOS/nixpkgs/nixos-unstable";
    # mdbook / plugins pinned separately — nixos-26.05 ships mdbook 0.5.x.
    #   mdbook 0.4.52, wasm-pack 0.13.1 (same nixpkgs rev)
    nixpkgs-mdbook.url = "github:NixOS/nixpkgs/bd16676f18040e23761b54a98e9d906a962220ae";
    #   mdbook-mermaid 0.16.2
    nixpkgs-mdbook-mermaid.url = "github:NixOS/nixpkgs/afd39ffbac700ed696fdee83842309302cae4c4e";
    #   mdbook-tabs 0.2.3 (mdbook-plugins; last release compatible with mdbook 0.4.x)
    nixpkgs-mdbook-plugins.url = "github:NixOS/nixpkgs/aaf821b4208b829d6a398cdd6b8db795daf4eb6d";
    #   mdbook-linkcheck 0.7.7 (removed from nixos-26.05)
    nixpkgs-mdbook-linkcheck.url = "github:NixOS/nixpkgs/bd16676f18040e23761b54a98e9d906a962220ae";
    #   mdbook-pagetoc 0.2.0 — DIVERGES from psibase-contributor (0.2.2): no nixpkgs rev
    #   ships 0.2.2 while keeping mdbook 0.4.x compatibility (0.3.0 breaks mdbook 0.4.x).
    nixpkgs-mdbook-pagetoc.url = "github:NixOS/nixpkgs/ac62194c3917d5f474c1a844b6fd6da2db95077d";
    #   nodejs 20.11.0
    nixpkgs-nodejs.url = "github:NixOS/nixpkgs/fea57dc5b57285d33918813d2f3695024d8fc9e8";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    fenix,
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
    flake-utils.lib.eachSystem ["x86_64-linux" "aarch64-linux"] (
      system: let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        # Shared WASI SDK (packages.wasi-sdk + contributor shell). Kept here so the
        # deploy/package path never imports nix/dev/shell.nix.
        # DIVERGES from psibase-contributor (wasi-sdk 24 embedded in llvm-18): standalone
        # wasi-sdk 29 matches psibase CMakeLists.txt default. Releases 24→29 are incremental
        # libc/toolchain updates on wasm32-wasip1; output may differ in size/debug metadata
        # but remains ABI-compatible for psibase's CMake/wasip1 build.
        wasiSdk = pkgs.stdenv.mkDerivation rec {
          pname = "wasi-sdk";
          version = "29";

          src = let
            base = "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${version}";
          in
            if pkgs.stdenv.hostPlatform.isAarch64
            then
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
      in {
        # `nix fmt` for every .nix file in the repo.
        # Wrapped so bare `nix fmt` formats the whole tree: this Nix invokes the
        # formatter with no arguments, and alejandra then reads stdin instead.
        formatter = pkgs.writeShellApplication {
          name = "alejandra-repo";
          runtimeInputs = [pkgs.alejandra];
          text = ''
            if [ "$#" -eq 0 ]; then
              exec alejandra .
            fi
            exec alejandra "$@"
          '';
        };

        # Contributor toolchain — see nix/dev/shell.nix (shell-only flake inputs).
        devShells.default = import ./nix/dev/shell.nix {
          inherit
            pkgs
            system
            fenix
            wasiSdk
            nixpkgs-cargo-component
            nixpkgs-cargo-generate
            nixpkgs-cursor-cli
            nixpkgs-mdbook
            nixpkgs-mdbook-mermaid
            nixpkgs-mdbook-plugins
            nixpkgs-mdbook-linkcheck
            nixpkgs-mdbook-pagetoc
            nixpkgs-nodejs
            ;
        };

        # Prebuilt package is x86_64-only; aarch64 still gets wasi-sdk + devShell.
        # Uses only nixpkgs + wasiSdk — does not import contributor shell inputs.
        packages =
          {
            wasi-sdk = wasiSdk;
          }
          // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isx86_64 (
            let
              psibase = pkgs.callPackage ./nix/deploy/package.nix {};
            in {
              inherit psibase;
              default = psibase;
            }
          );

        checks = pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isx86_64 {
          module-eval = let
            sys = nixpkgs.lib.nixosSystem {
              inherit system;
              modules = [
                self.nixosModules.psibase
                {
                  boot.loader.grub.enable = false;
                  fileSystems."/" = {
                    device = "/dev/null";
                    fsType = "ext4";
                  };
                  system.stateVersion = "25.05";
                  services.psibase = {
                    enable = true;
                    producer = "prod";
                    p2p = true;
                    softHsm = {
                      enable = true;
                      pinFile = "/run/secrets/psibase-pin";
                    };
                  };
                }
              ];
            };
          in
            pkgs.runCommand "psibase-module-eval" {} ''
              echo ${builtins.unsafeDiscardStringContext sys.config.system.build.toplevel.drvPath} > $out
            '';

          overlay-eval = let
            overlaid = import nixpkgs {
              inherit system;
              overlays = [self.overlays.default];
            };
          in
            pkgs.runCommand "psibase-overlay-eval" {} ''
              echo ${builtins.unsafeDiscardStringContext overlaid.psibase.drvPath} > $out
            '';

          vm = import ./nix/deploy/test.nix {inherit pkgs self;};
        };
      }
    )
    // {
      overlays.default = final: prev: {
        psibase =
          self.packages.${prev.stdenv.hostPlatform.system}.psibase
            or (throw "psibase: no prebuilt package for ${prev.stdenv.hostPlatform.system}");
      };

      # imports = [ inputs.psibase.nixosModules.psibase ];
      nixosModules.psibase = {
        imports = [
          ./nix/deploy/module.nix
          (
            {
              pkgs,
              lib,
              ...
            }: {
              services.psibase.package = lib.mkDefault (
                self.packages.${pkgs.stdenv.hostPlatform.system}.psibase
                  or (throw "psibase: no prebuilt package for ${pkgs.stdenv.hostPlatform.system}; set services.psibase.package explicitly")
              );
            }
          )
        ];
      };
      nixosModules.default = self.nixosModules.psibase;
    };
}
