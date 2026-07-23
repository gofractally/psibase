# Psibase runtime package (psinode + psibase CLI + share/psibase data).
#
# Initial strategy: repackage the published Ubuntu SDK tarball and patchelf it
# for NixOS. Replace this body with a pure source mkDerivation later; keep the
# same $out/{bin,share/psibase} layout so the NixOS module does not care.
{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  openssl,
  zlib,
}: let
  version = "0.23.0-pre";
  # Bump version + hash together when cutting a new release package.
  srcUrl = "https://github.com/gofractally/psibase/releases/download/v${version}/psidk-ubuntu-2404.tar.gz";
  srcHash = "sha256-l9bdB9RKz9FQLiBnXaQsHNoveOTMt1r5xRghLTfqKsQ=";
in
  stdenv.mkDerivation rec {
    pname = "psibase";
    inherit version;

    src = fetchurl {
      url = srcUrl;
      hash = srcHash;
    };

    sourceRoot = "psidk-ubuntu-2404";

    nativeBuildInputs = [
      autoPatchelfHook
    ];

    buildInputs = [
      openssl
      zlib
      stdenv.cc.cc.lib
    ];

    # Prebuilt release binaries; do not strip (especially the Rust psibase CLI).
    dontStrip = true;
    dontConfigure = true;
    dontBuild = true;

    installPhase = ''
      runHook preInstall

      mkdir -p $out
      # Runtime needs bin/ + share/psibase/ (PSIBASE_DATADIR via installPrefix).
      # Keep the full SDK layout so the package is also usable as a minimal psidk.
      cp -a . $out/

      runHook postInstall
    '';

    meta = with lib; {
      description = "Psibase node and client (psinode, psibase)";
      homepage = "https://about.psibase.io";
      license = licenses.mit;
      platforms = ["x86_64-linux"];
      mainProgram = "psinode";
    };
  }
