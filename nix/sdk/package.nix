# Psibase SDK package for out-of-tree Rust package development (packages.psidk).
#
# Repackages the published Ubuntu release tarball and patchelfs it for Nix;
# it does not build from source. Rust-only: drops C++ wasi-sysroot / cmake
# helpers. See ../sdk-dx-plan.md (Phase 0 inventory) and ./README.md.
#
# cargo-psibase: installed when present in the tarball. Current releases do not
# ship it (CMake never installed it into the Client component). After a release
# that includes bin/cargo-psibase, this derivation picks it up automatically.
# Until then, `nix build .#psidk` succeeds without it; the SDK shell installs
# cargo-psibase from crates.io (see nix/release.nix cargoPsibaseVersion).
{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  openssl,
  zlib,
}: let
  release = import ../release.nix;
in
  lib.throwIfNot stdenv.hostPlatform.isx86_64
  "prebuilt psidk is only available on x86_64-linux (got ${stdenv.hostPlatform.system})"
  (stdenv.mkDerivation {
    pname = "psidk";
    inherit (release) version;

    src = fetchurl {
      url = release.srcUrl;
      hash = release.srcHash;
    };

    sourceRoot = release.sourceRoot;

    nativeBuildInputs = [
      autoPatchelfHook
    ];

    buildInputs = [
      openssl
      zlib
      stdenv.cc.cc.lib
    ];

    dontStrip = true;
    dontConfigure = true;
    dontBuild = true;

    installPhase = builtins.readFile ./install.sh;

    doInstallCheck = true;
    installCheckPhase = builtins.readFile ./install-check.sh;

    meta = with lib; {
      description = "Psibase SDK (psinode, psibase, psitest, package data) for Rust package development";
      homepage = "https://about.psibase.io";
      license = licenses.mit;
      sourceProvenance = with sourceTypes; [binaryNativeCode];
      platforms = ["x86_64-linux"];
      mainProgram = "psibase";
    };
  })
