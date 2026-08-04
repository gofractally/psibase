# Psibase runtime package (psinode + psibase CLI + share/psibase data).
#
# Repackages the published Ubuntu release tarball and patchelfs it for NixOS.
# What this package is, what it deliberately omits, and how to bump it:
# see ./README.md. Comments here cover only per-path install decisions.
{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  openssl,
  zlib,
}: let
  version = "0.23.0-pre";
  # Bump version + hash together when cutting a new release package (README.md).
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

      # Enumerate what the runtime actually uses rather than copying the tree:
      # a missing path then fails the build instead of silently shipping a
      # broken layout. Consciously skipped: share/wasi-sysroot,
      # share/psibase/cmake, share/psibase/python (psitest helpers), share/gdb,
      # and bin/psidk-cmake-args -- all dev-shell concerns.
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

      # The $out/{bin,share/psibase} contract that psinode, the psibase CLI and
      # services.psibase all resolve against. The installPhase already fails on
      # a missing *source* path; this guards the other direction -- that the
      # tree which shipped is the one they expect.
      for p in \
        bin/psinode bin/psibase bin/psitest \
        share/psibase/config.in \
        share/psibase/packages \
        share/psibase/wasm; do
        if [ ! -e "$out/$p" ]; then
          echo "missing from layout: $p" >&2
          exit 1
        fi
      done

      # test -e follows symlinks, so this also proves the relative
      # x-admin/packages -> ../../packages link still resolves after cp -a.
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
