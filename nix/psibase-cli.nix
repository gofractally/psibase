# Native `psibase` CLI. Separate from the CMake ninja so a C++ change
# does not cargo-build --bin psibase. cargo-psibase still builds in-tree
# (needed to pack Rust services).
{
  lib,
  stdenv,
  rustToolchain,
  cargoVendor,
  pkg-config,
  openssl,
  llvmPackages,
  removeReferencesTo,
  version ? "0.27.0",
}:

stdenv.mkDerivation {
  pname = "psibase-cli";
  inherit version;

  src = lib.fileset.toSource {
    root = ../rust;
    fileset = ../rust;
  };

  nativeBuildInputs = [
    rustToolchain
    pkg-config
    removeReferencesTo
  ];

  buildInputs = [
    openssl
  ];

  LIBCLANG_PATH = "${llvmPackages.libclang.lib}/lib";
  OPENSSL_NO_VENDOR = "1";
  CARGO_TERM_COLOR = "always";
  CARGO_NET_OFFLINE = "true";
  RUSTFLAGS = "--remap-path-prefix ${rustToolchain}=/rustc";

  hardeningDisable = [ "all" ];
  dontConfigure = true;

  disallowedReferences = [ rustToolchain ];

  buildPhase = ''
    runHook preBuild
    export HOME=$NIX_BUILD_TOP/home
    export CARGO_HOME=$NIX_BUILD_TOP/cargo-home
    mkdir -p "$HOME" "$CARGO_HOME" .cargo
    cp -a ${cargoVendor}/. $NIX_BUILD_TOP/cargo-vendor
    chmod -R u+w $NIX_BUILD_TOP/cargo-vendor
    cat > .cargo/config.toml <<EOF
    [source.crates-io]
    replace-with = "vendored-sources"

    [source.vendored-sources]
    directory = "$NIX_BUILD_TOP/cargo-vendor"

    [net]
    offline = true
    EOF
    cp .cargo/config.toml "$CARGO_HOME/config.toml"
    cargo build -r --locked --offline --bin psibase --manifest-path Cargo.toml
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 target/release/psibase "$out/bin/psibase"
    remove-references-to -t ${rustToolchain} "$out/bin/psibase"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    "$out/bin/psibase" --version
    runHook postInstallCheck
  '';

  meta = {
    description = "psibase command-line client";
    license = lib.licenses.mit;
    mainProgram = "psibase";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
