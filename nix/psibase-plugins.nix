# cargo-component wasm plugins (`packages/` workspace) plus component-parser.
# Separate from the CMake ninja so a C++ change does not rebuild them.
# Other plugins still build in-tree via cargo-psibase (user/system workspaces).
{
  lib,
  stdenv,
  rustToolchain,
  cargoVendor,
  cargoComponent,
  wasmTools,
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

  # Crate names from add_rs_component_workspace(packages/:Plugins ...) in CMakeLists.txt.
  pluginWasm = [
    "accounts.wasm"
    "aes.wasm"
    "auth_any.wasm"
    "auth_delegate.wasm"
    "auth_sig.wasm"
    "base64.wasm"
    "brotli_codec.wasm"
    "kdf.wasm"
    "kvtests.wasm"
    "setcode.wasm"
    "clientdata.wasm"
    "invite.wasm"
    "packages.wasm"
    "permissions.wasm"
    "sites.wasm"
    "host_common.wasm"
    "host_db.wasm"
    "host_prompt.wasm"
    "host_types.wasm"
    "host_auth.wasm"
    "host_crypto.wasm"
    "web_crypto.wasm"
    "transact.wasm"
    "workshop.wasm"
    "fractal_core.wasm"
    "config.wasm"
    "homepage.wasm"
    "producers.wasm"
  ];
in
stdenv.mkDerivation {
  pname = "psibase-plugins";
  inherit version;

  src = fileset.toSource {
    root = repoRoot;
    fileset = fileset.unions (
      [
        (fileset.difference (repoRoot + "/rust") (
          fileset.maybeMissing (repoRoot + "/rust/target")
        ))
        (packagesDir + "/Cargo.toml")
        (packagesDir + "/Cargo.lock")
        (packagesDir + "/plugin-workspace-hack")
        (packagesDir + "/user/CommonApi/common/packages/component-parser")
      ]
      ++ pluginDirs
    );
  };

  nativeBuildInputs = [
    rustToolchain
    cargoComponent
    wasmTools
  ];

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
    mkdir -p packages/.cargo
    cp .cargo/config.toml packages/.cargo/config.toml

    cargo component build -r --locked --offline \
      --target wasm32-wasip1 \
      --manifest-path packages/Cargo.toml \
      --target-dir $NIX_BUILD_TOP/plugin-target

    cargo component build -r --locked --offline \
      --target wasm32-unknown-unknown \
      --manifest-path packages/user/CommonApi/common/packages/component-parser/Cargo.toml \
      --target-dir $NIX_BUILD_TOP/parser-target
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    ${lib.concatMapStrings (f: ''
      install -Dm644 $NIX_BUILD_TOP/plugin-target/wasm32-wasip1/release/${f} "$out/${f}"
    '') pluginWasm}
    install -Dm644 $NIX_BUILD_TOP/parser-target/wasm32-unknown-unknown/release/component_parser.wasm \
      "$out/component_parser.wasm"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    for f in ${lib.concatStringsSep " " pluginWasm} component_parser.wasm; do
      if [ ! -s "$out/$f" ]; then
        echo "missing plugin wasm: $f" >&2
        exit 1
      fi
    done
    runHook postInstallCheck
  '';

  meta = {
    description = "psibase cargo-component wasm plugins";
    license = lib.licenses.mit;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
