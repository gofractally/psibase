# Psibase runtime package (psinode + psibase CLI + share/psibase data).
# Bump notes and layout: ./README.md
# Shared release pin: ../release.nix (also used by packages.psidk).
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
  # Ubuntu SDK tarball is x86_64 ELF; exporting it on other systems yields a
  # broken derivation. Fail at eval with a clear message instead.
  lib.throwIfNot stdenv.hostPlatform.isx86_64
  "prebuilt psibase is only available on x86_64-linux (got ${stdenv.hostPlatform.system}); override services.psibase.package"
  (stdenv.mkDerivation {
    pname = "psibase";
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
      description = "Psibase node and client (psinode, psibase)";
      homepage = "https://about.psibase.io";
      license = licenses.mit;
      sourceProvenance = with sourceTypes; [binaryNativeCode];
      platforms = ["x86_64-linux"];
      mainProgram = "psinode";
    };
  })
