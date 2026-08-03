# Psibase runtime package (psinode + psibase CLI + share/psibase data).
#
# Repackages the published Ubuntu release tarball and patchelfs it for NixOS;
# it does not build psibase from source. The NixOS module depends only on the
# $out/{bin,share/psibase} layout, so any derivation producing that layout can
# be substituted via services.psibase.package.
#
# This is deliberately NOT a psidk: the published tarball is the full SDK, and
# the dev toolchain is the dev shell's job (see flake.nix). See installPhase.
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
  # Ubuntu SDK tarball is x86_64 ELF; exporting it on other systems yields a
  # broken derivation. Fail at eval with a clear message instead.
  lib.throwIfNot stdenv.hostPlatform.isx86_64
  "prebuilt psibase is only available on x86_64-linux (got ${stdenv.hostPlatform.system}); override services.psibase.package"
  (stdenv.mkDerivation {
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

    # The release binaries link only these; CMake's ICU_LIBRARY_DIR does not
    # produce a libicu* NEEDED entry, so no ICU pin is required here.
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

      # Install only the runtime, not the SDK. The psidk tarball unpacks to
      # 314M, of which share/wasi-sysroot is 241M of WASM sysroot headers and
      # static libs for building services -- dead weight on a node, and the dev
      # shell provides its own wasi-sdk anyway. Also skipped: share/psibase/cmake,
      # share/psibase/python (psitest helpers), share/gdb, and
      # bin/psidk-cmake-args. So enumerate what the runtime actually uses; a
      # missing path fails the build rather than silently shipping a broken
      # layout.
      #
      # psitest is included because `psibase create-snapshot` / `load-snapshot`
      # are external subcommands: psibase runs share/psibase/wasm/psibase-*.wasm
      # via a psitest sibling in bin/ (rust/psibase/src/main.rs).
      for prog in psinode psibase psitest; do
        install -Dm755 "bin/$prog" "$out/bin/$prog"
      done

      mkdir -p $out/share/psibase
      # psinode reads config.in when initializing a database; both psinode
      # (--database-template) and `psibase boot` read packages/ as their default
      # package registry. Both locate these relative to the resolved exe path,
      # so this layout must stay $out/{bin,share/psibase}.
      install -Dm644 share/psibase/config.in $out/share/psibase/config.in
      cp -a share/psibase/packages $out/share/psibase/packages
      cp -a share/psibase/wasm $out/share/psibase/wasm
      # services/ is a dir plus one relative symlink (x-admin/packages ->
      # ../../packages). psinode's database_template_path() points here but is
      # currently uncalled, and nothing else in-tree reads it -- kept anyway
      # because it costs nothing and is part of the published data layout.
      cp -a share/psibase/services $out/share/psibase/services

      # Nice to have, but not worth failing a node build over.
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

      # Catch a patchelf/soname regression here instead of on the node.
      $out/bin/psibase --version
      # psinode prints its version to stderr and exits 1 by design
      # (programs/psinode/main.cpp), so check the output, not the status.
      # Deliberately not a pipeline: stdenv runs with `set -o pipefail`, so
      # piping psinode's output into grep would fail on its exit status.
      psinodeVersion=$($out/bin/psinode --version 2>&1 || true)
      echo "psinode --version: $psinodeVersion"
      case "$psinodeVersion" in
        "psinode "*) ;;
        *)
          echo "unexpected psinode --version output" >&2
          exit 1
          ;;
      esac

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
