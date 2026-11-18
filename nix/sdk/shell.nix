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
  # nix/sdk/package-templates (out-of-tree cargo-generate tree)
  packageTemplates,
}:
let
  release = import ../release.nix;

  cargoComponent = (import nixpkgs-cargo-component { inherit system; }).cargo-component;
  cargoToolsPkgs = import nixpkgs-cargo-generate { inherit system; };
  cargoGenerate = cargoToolsPkgs.cargo-generate;
  cargoEdit = cargoToolsPkgs.cargo-edit;
  # Same pin as monorepo (nodejs 24.22.1 CVE release; see flake.nix nixpkgs-nodejs).
  nodejs = (import nixpkgs-nodejs { inherit system; }).nodejs_24;

  rustToolchain = fenix.packages.${system}.fromToolchainFile {
    file = ../rust-toolchain.toml;
    sha256 = "sha256-P30Tm3O7vQAE725YtDCDHGjNrSsfZO4us11UwJGZSJo=";
  };

  substitutePlaceholders = replacements: file:
    builtins.replaceStrings
    (builtins.attrNames replacements)
    (builtins.attrValues replacements)
    (builtins.readFile file);

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

    installPhase = substitutePlaceholders {
      "@nodejs@" = "${nodejs}";
    } ./yarn-berry-install.sh;
  };

  # Package-dev CLI (release tarball / packages.psidk stay named "psidk").
  #   psiapp chain up|down|status …
  #   psiapp new <name>
  psiapp = pkgs.writeShellApplication {
    name = "psiapp";
    runtimeInputs = [
      psidk
      cargoGenerate
      pkgs.curl
      pkgs.coreutils
      pkgs.findutils
      pkgs.gnugrep
      pkgs.gnused
    ];
    excludeShellChecks = [ "SC2034" ];
    text = substitutePlaceholders {
      "@psibaseCrateVersion@" = release.psibaseCrateVersion;
    } ./psiapp.sh;
  };

  sdkPackages = with pkgs; [
    psidk
    psiapp
    rustToolchain
    cargoComponent
    cargoGenerate
    cargoEdit
    binaryen
    wabt
    wasm-pack
    wasm-tools
    nodejs
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

  shellHook = substitutePlaceholders {
    "@bashInteractive@" = "${pkgs.bashInteractive}";
    "@psidk@" = "${psidk}";
    "@wasiSdk@" = "${wasiSdk}";
    "@packageTemplates@" = "${packageTemplates}";
    "@psibaseCrateVersion@" = release.psibaseCrateVersion;
    "@cargoPsibaseVersion@" = release.cargoPsibaseVersion;
    "@bashCompletion@" = "${pkgs.bash-completion}";
    "@cc@" = "${pkgs.stdenv.cc}";
  } ./shell-hook.sh;
}
