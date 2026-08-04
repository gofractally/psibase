# Psibase SDK package for out-of-tree Rust package development (packages.psidk).
#
# Repackages the published Ubuntu release tarball and patchelfs it for Nix;
# it does not build from source. Rust-only: drops C++ wasi-sysroot / cmake
# helpers. See ../sdk-dx-plan.md (Phase 0 inventory) and ./README.md.
#
# cargo-psibase: installed when present in the tarball. Current v0.23.0-pre
# does not ship it (CMake never installed it into the Client component).
# After a release that includes bin/cargo-psibase, this derivation picks it up
# automatically. Until then, `nix build .#psidk` succeeds without it.
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

    installPhase = ''
      runHook preInstall

      # Runtime / package-dev tools. cargo-psibase is optional until the next
      # release that ships it (see CMake Client install).
      for prog in psinode psibase psitest; do
        install -Dm755 "bin/$prog" "$out/bin/$prog"
      done
      if [ -f bin/cargo-psibase ]; then
        install -Dm755 bin/cargo-psibase "$out/bin/cargo-psibase"
      else
        echo "note: bin/cargo-psibase missing from release tarball (expected for v0.23.0-pre)"
      fi

      # Skip bin/psidk-cmake-args — C++ only.

      mkdir -p $out/share/psibase
      install -Dm644 share/psibase/config.in $out/share/psibase/config.in
      cp -a share/psibase/packages $out/share/psibase/packages
      cp -a share/psibase/wasm $out/share/psibase/wasm
      # Drop this line when bumping past 0.23 (services/ removed in 0.24).
      cp -a share/psibase/services $out/share/psibase/services

      # Optional helpers used by some psitest / scripting paths.
      if [ -d share/psibase/python ]; then
        cp -a share/psibase/python $out/share/psibase/python
      fi
      if [ -d share/psibase/licenses ]; then
        cp -a share/psibase/licenses $out/share/psibase/licenses
      fi
      if [ -d share/man ]; then
        cp -a share/man $out/share/man
      fi

      # Explicitly not installed (Rust-only SDK):
      #   share/wasi-sysroot  (~241M; flake wasi-sdk + Rust wasm targets instead)
      #   share/psibase/cmake (C++ service build)
      #   share/gdb

      runHook postInstall
    '';

    doInstallCheck = true;
    installCheckPhase = ''
      runHook preInstallCheck

      $out/bin/psibase --version
      psinodeVersion=$($out/bin/psinode --version 2>&1 || true)
      echo "psinode --version: $psinodeVersion"
      case "$psinodeVersion" in
        "psinode "*) ;;
        *)
          echo "unexpected psinode --version output" >&2
          exit 1
          ;;
      esac

      if [ -x "$out/bin/cargo-psibase" ]; then
        $out/bin/cargo-psibase --help >/dev/null
      else
        echo "note: cargo-psibase not in this psidk (release packaging gap; see sdk-dx-plan.md)"
      fi

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

      # Layout contract: CLI resolves data as dirname(exe)/../share/psibase
      # when exe lives in .../bin. Smoke-check relative to the installed binary.
      shareFromBin="$(dirname "$out/bin/psibase")/../share/psibase"
      if [ ! -d "$shareFromBin/packages" ]; then
        echo "share path relative to bin/psibase does not resolve: $shareFromBin" >&2
        exit 1
      fi

      if [ -e "$out/share/wasi-sysroot" ]; then
        echo "wasi-sysroot must not be shipped in Rust-only psidk" >&2
        exit 1
      fi
      if [ -e "$out/share/psibase/cmake" ]; then
        echo "share/psibase/cmake must not be shipped in Rust-only psidk" >&2
        exit 1
      fi
      if [ -e "$out/bin/psidk-cmake-args" ]; then
        echo "psidk-cmake-args must not be shipped in Rust-only psidk" >&2
        exit 1
      fi

      if [ ! -e "$out/share/psibase/services/x-admin/packages" ]; then
        echo "share/psibase/services/x-admin/packages does not resolve" >&2
        exit 1
      fi

      runHook postInstallCheck
    '';

    meta = with lib; {
      description = "Psibase SDK (psinode, psibase, psitest, package data) for Rust package development";
      homepage = "https://about.psibase.io";
      license = licenses.mit;
      sourceProvenance = with sourceTypes; [binaryNativeCode];
      platforms = ["x86_64-linux"];
      mainProgram = "psibase";
    };
  })
