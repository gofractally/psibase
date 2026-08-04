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

    installPhase = ''
      runHook preInstall

      for prog in psinode psibase psitest; do
        install -Dm755 "bin/$prog" "$out/bin/$prog"
      done

      mkdir -p $out/share/psibase
      install -Dm644 share/psibase/config.in $out/share/psibase/config.in
      cp -a share/psibase/packages $out/share/psibase/packages
      cp -a share/psibase/wasm $out/share/psibase/wasm
      # Drop this line when bumping past 0.23 (services/ removed in 0.24).
      cp -a share/psibase/services $out/share/psibase/services

      if [ -d share/psibase/licenses ]; then
        cp -a share/psibase/licenses $out/share/psibase/licenses
      fi
      if [ -d share/man ]; then
        cp -a share/man $out/share/man
      fi

      runHook postInstall
    '';

    doInstallCheck = true;
    installCheckPhase = ''
      runHook preInstallCheck

      $out/bin/psibase --version
      # psinode --version writes to stderr and exits 1.
      psinodeVersion=$($out/bin/psinode --version 2>&1 || true)
      echo "psinode --version: $psinodeVersion"
      case "$psinodeVersion" in
        "psinode "*) ;;
        *)
          echo "unexpected psinode --version output" >&2
          exit 1
          ;;
      esac

      for p in \
        bin/psinode bin/psibase bin/psitest \
        share/psibase/config.in \
        share/psibase/packages \
        share/psibase/packages/index.json \
        share/psibase/wasm; do
        if [ ! -e "$out/$p" ]; then
          echo "missing from layout: $p" >&2
          exit 1
        fi
      done

      if [ ! -e "$out/share/psibase/services/x-admin/packages" ]; then
        echo "share/psibase/services/x-admin/packages does not resolve" >&2
        exit 1
      fi

      runHook postInstallCheck
    '';

    meta = with lib; {
      description = "Psibase node and client (psinode, psibase)";
      homepage = "https://about.psibase.io";
      license = licenses.mit;
      sourceProvenance = with sourceTypes; [binaryNativeCode];
      platforms = ["x86_64-linux"];
      mainProgram = "psinode";
    };
  })
