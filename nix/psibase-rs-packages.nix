# cargo-psibase packages (user/ + system/ workspaces). Separate from CMake
# pack so a C++ or cargo-component-plugin change does not rebuild Tokens etc.
{
  lib,
  stdenv,
  rustToolchain,
  cargoVendor,
  cargoComponent,
  wasmTools,
  pkg-config,
  openssl,
  llvmPackages,
  binaryen,
  unzip,
  zip,
  yarnUis,
  wasmServices,
  version ? "0.27.0",
}:

let
  inherit (lib) fileset;
  repoRoot = ../.;
  packagesDir = ../packages;

  pluginDirs =
    let
      collect =
        cat:
        let
          dir = packagesDir + "/${cat}";
          ents = builtins.readDir dir;
        in
        lib.concatMap (
          name:
          let
            plugin = dir + "/${name}/plugin";
          in
          lib.optional (ents.${name} == "directory" && builtins.pathExists plugin) plugin
        ) (builtins.attrNames ents);
    in
    collect "system" ++ collect "user";

  pkgFileset =
    cat: name:
    fileset.difference (packagesDir + "/${cat}/${name}") (
      fileset.maybeMissing (packagesDir + "/${cat}/${name}/ui")
    );

  systemPkgs = [
    "AuthDyn"
    "Credentials"
    "VirtualServer"
    "StagedTx"
  ];

  userPkgs = [
    "Chainmail"
    "Symbol"
    "TokenStream"
    "TokenSwap"
    "DiffAdjust"
    "Profiles"
    "Evaluations"
    "Nft"
    "Tokens"
    "Fractals"
    "FractalGen"
    "Guilds"
    "FractalTester"
    "Branding"
    "BrotliSvc"
    "FaucetTok"
    "Registry"
    "Subgroups"
    "Identity"
    "NameMarket"
  ];

  expectedPsi = map (n: "${n}.psi") (systemPkgs ++ userPkgs);
in
stdenv.mkDerivation {
  pname = "psibase-rs-packages";
  inherit version;

  src = fileset.toSource {
    root = repoRoot;
    fileset = fileset.unions (
      [
        (fileset.difference (repoRoot + "/rust") (
          fileset.maybeMissing (repoRoot + "/rust/target")
        ))
        (packagesDir + "/user/Cargo.toml")
        (packagesDir + "/user/Cargo.lock")
        (packagesDir + "/user/user-workspace-hack")
        (packagesDir + "/system/Cargo.toml")
        (packagesDir + "/system/Cargo.lock")
        (packagesDir + "/system/system-workspace-hack")
      ]
      ++ map (pkgFileset "system") systemPkgs
      ++ map (pkgFileset "user") userPkgs
      ++ map (dir: fileset.fileFilter (file: file.hasExt "wit") dir) pluginDirs
    );
  };

  nativeBuildInputs = [
    rustToolchain
    cargoComponent
    wasmTools
    pkg-config
    binaryen
    unzip
    zip
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
  dontFixup = true;
  dontStrip = true;

  buildPhase = ''
    runHook preBuild
    unset NIX_LDFLAGS NIX_LDFLAGS_BEFORE NIX_CFLAGS_LINK LD_LIBRARY_PATH
    unset NIX_CFLAGS_COMPILE NIX_CFLAGS_COMPILE_BEFORE CFLAGS CXXFLAGS LDFLAGS

    export HOME=$NIX_BUILD_TOP/home
    export CARGO_HOME=$NIX_BUILD_TOP/cargo-home
    export TMPDIR=$NIX_BUILD_TOP/tmp
    export CARGO_COMPONENT_CACHE_DIR=$NIX_BUILD_TOP/cargo-component-cache
    mkdir -p "$HOME" "$CARGO_HOME" "$TMPDIR" "$CARGO_COMPONENT_CACHE_DIR" .cargo

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
    mkdir -p packages/user/.cargo packages/system/.cargo rust/.cargo
    cp .cargo/config.toml packages/user/.cargo/config.toml
    cp .cargo/config.toml packages/system/.cargo/config.toml
    cp .cargo/config.toml rust/.cargo/config.toml

    mkdir -p packages/user/TokenStream/ui/dist \
      packages/user/Evaluations/ui/dist \
      packages/user/Fractals/ui/dist \
      packages/user/Identity/ui/dist
    cp -a ${yarnUis.token-stream}/. packages/user/TokenStream/ui/dist/
    cp -a ${yarnUis.evaluations}/. packages/user/Evaluations/ui/dist/
    cp -a ${yarnUis.fractals}/. packages/user/Fractals/ui/dist/
    cp -a ${yarnUis.identity}/. packages/user/Identity/ui/dist/
    chmod -R u+w packages/user/TokenStream/ui/dist \
      packages/user/Evaluations/ui/dist \
      packages/user/Fractals/ui/dist \
      packages/user/Identity/ui/dist

    cargo build -r --locked --offline --bin cargo-psibase \
      --manifest-path rust/Cargo.toml \
      --target-dir $NIX_BUILD_TOP/cargo-psibase-target
    export PATH="$NIX_BUILD_TOP/cargo-psibase-target/release:$PATH"

    cargo-psibase package \
      --psitest ${wasmServices}/bin/psitest \
      --manifest-path packages/system/Cargo.toml \
      --target-dir $NIX_BUILD_TOP/system-target
    cargo-psibase package \
      --psitest ${wasmServices}/bin/psitest \
      --manifest-path packages/user/Cargo.toml \
      --target-dir $NIX_BUILD_TOP/user-target
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -a $NIX_BUILD_TOP/system-target/wasm32-wasip1/release/packages/*.psi "$out/"
    cp -a $NIX_BUILD_TOP/user-target/wasm32-wasip1/release/packages/*.psi "$out/"
    bash ${./fix-psi-wasm.sh} "$out"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    for f in ${lib.concatStringsSep " " expectedPsi}; do
      if [ ! -s "$out/$f" ]; then
        echo "missing rust package: $f" >&2
        echo "have:" >&2
        ls -1 "$out" >&2
        exit 1
      fi
    done
    runHook postInstallCheck
  '';

  meta = {
    description = "psibase cargo-psibase rust service packages";
    license = lib.licenses.mit;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
