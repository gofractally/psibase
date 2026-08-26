# Per-UI Yarn/Vite packages. Each has a tight fileset so a C++ change does not
# rebuild Vite. XAdmin is included (cargo-component + jco in its yarn build).
{
  lib,
  stdenv,
  stdenvNoCC,
  yarnBerry,
  nodejs20,
  cacert,
  yarnOfflineCache,
  rustToolchain,
  cargoVendor,
  cargoComponent,
  wasmTools,
  llvmPackages,
  pkg-config,
  openssl,
  version ? "0.27.0",
}:

let
  inherit (lib) fileset;
  repoRoot = ../.;
  packagesDir = ../packages;

  workspaceMeta = fileset.unions [
    (packagesDir + "/yarn.lock")
    (packagesDir + "/package.json")
    (packagesDir + "/.yarnrc.yml")
    (packagesDir + "/if-build-needed.mjs")
    (packagesDir + "/build.shared.mjs")
    (packagesDir + "/vite.shared.ts")
    (packagesDir + "/eslint.config.mjs")
    (packagesDir + "/prettier.config.cjs")
    (packagesDir + "/tsconfig.json")
    (packagesDir + "/tsconfig.base.json")
    (packagesDir + "/tsconfig.app.json")
    (packagesDir + "/tsconfig.node.json")
    (packagesDir + "/components.json")
    (fileset.fileFilter (file: file.name == "package.json") packagesDir)
  ];

  # Flake copy is git-filtered, so gitignored dist/node_modules are not in these trees.
  commonLibFiles = packagesDir + "/user/CommonApi/common/packages/common-lib";
  sharedUiFiles = packagesDir + "/shared-ui";

  mkYarnUi =
    {
      pname,
      workspace,
      relPath,
      extraFileset ? null,
      extraBuild ? "",
      withSharedUi ? true,
      commonLibDist ? null,
    }:
    stdenvNoCC.mkDerivation {
      inherit pname version;
      src = fileset.toSource {
        root = packagesDir;
        fileset = fileset.unions (
          [
            workspaceMeta
            commonLibFiles
            (packagesDir + "/${relPath}")
          ]
          ++ lib.optional withSharedUi sharedUiFiles
          ++ lib.optional (extraFileset != null) extraFileset
        );
      };

      nativeBuildInputs = [
        yarnBerry
        nodejs20
        cacert
      ];

      dontConfigure = true;
      dontFixup = true;

      YARN_ENABLE_TELEMETRY = "0";
      YARN_ENABLE_NETWORK = "0";
      YARN_ENABLE_OFFLINE_MODE = "true";
      COREPACK_ENABLE_NETWORK = "0";
      PSIREBUILD = "true";
      SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";

      buildPhase = ''
        runHook preBuild
        export HOME=$NIX_BUILD_TOP/home
        mkdir -p "$HOME" "$NIX_BUILD_TOP/.caches/yarn"
        cp -a ${yarnOfflineCache}/. "$NIX_BUILD_TOP/.caches/yarn/"
        chmod -R u+w "$NIX_BUILD_TOP/.caches/yarn"
        yarn install --immutable --immutable-cache --mode=skip-build
        ${lib.optionalString (commonLibDist != null) ''
          mkdir -p user/CommonApi/common/packages/common-lib/dist
          cp -a ${commonLibDist}/. user/CommonApi/common/packages/common-lib/dist/
        ''}
        ${extraBuild}
        yarn workspace ${workspace} build
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p "$out"
        cp -a ${relPath}/dist/. "$out/"
        runHook postInstall
      '';

      doInstallCheck = true;
      installCheckPhase = ''
        runHook preInstallCheck
        if [ "${workspace}" = "@psibase/common-lib" ]; then
          test -f "$out/common-lib.js"
        else
          test -f "$out/index.html"
        fi
        runHook postInstallCheck
      '';
    };

  mkApp = args: mkYarnUi (args // { commonLibDist = common-lib; });

  common-lib = mkYarnUi {
    pname = "psibase-ui-common-lib";
    workspace = "@psibase/common-lib";
    relPath = "user/CommonApi/common/packages/common-lib";
    withSharedUi = false;
  };
in
{
  inherit common-lib;

  accounts = mkApp {
    pname = "psibase-ui-accounts";
    workspace = "@psibase/accounts-ui";
    relPath = "system/Accounts/ui";
  };
  evaluations = mkApp {
    pname = "psibase-ui-evaluations";
    workspace = "@psibase/evaluations-ui";
    relPath = "user/Evaluations/ui";
  };
  fractals = mkApp {
    pname = "psibase-ui-fractals";
    workspace = "@psibase/fractals-ui";
    relPath = "user/Fractals/ui";
  };
  fractal-core = mkApp {
    pname = "psibase-ui-fractal-core";
    workspace = "@psibase/fractal-core-ui";
    relPath = "user/FractalCore/ui";
  };
  token-stream = mkApp {
    pname = "psibase-ui-token-stream";
    workspace = "token-stream";
    relPath = "user/TokenStream/ui";
  };
  plugin-tester = mkApp {
    pname = "psibase-ui-plugin-tester";
    workspace = "@psibase/plugin-tester-ui";
    relPath = "user/CommonApi/common/packages/plugin-tester/ui";
  };
  explorer = mkApp {
    pname = "psibase-ui-explorer";
    workspace = "@psibase/explorer-ui";
    relPath = "user/Explorer/ui";
    extraFileset = packagesDir + "/user/CommonApi/common/resources/useGraphQLQuery.d.ts";
    extraBuild = "yarn workspace @psibase/explorer-ui prepare";
  };
  homepage = mkApp {
    pname = "psibase-ui-homepage";
    workspace = "@psibase/homepage-ui";
    relPath = "user/Homepage/ui";
  };
  identity = mkApp {
    pname = "psibase-ui-identity";
    workspace = "@psibase/identity-ui";
    relPath = "user/Identity/ui";
  };
  permissions = mkApp {
    pname = "psibase-ui-permissions";
    workspace = "@psibase/permissions-ui";
    relPath = "user/Permissions/ui";
  };
  supervisor = mkApp {
    pname = "psibase-ui-supervisor";
    workspace = "@psibase/supervisor-ui";
    relPath = "user/Supervisor/ui";
  };
  workshop = mkApp {
    pname = "psibase-ui-workshop";
    workspace = "@psibase/workshop-ui";
    relPath = "user/Workshop/ui";
  };
  config = mkApp {
    pname = "psibase-ui-config";
    workspace = "@psibase/config-ui";
    relPath = "user/Config/ui";
  };
  xproxy = mkApp {
    pname = "psibase-ui-xproxy";
    workspace = "@psibase/xproxy-ui";
    relPath = "local/XProxy/ui";
  };

  # cargo-component + jco + vite. Fileset includes rust/psibase (path dep).
  xadmin = stdenv.mkDerivation {
    pname = "psibase-ui-xadmin";
    inherit version;
    src = fileset.toSource {
      root = repoRoot;
      fileset = fileset.unions [
        workspaceMeta
        commonLibFiles
        sharedUiFiles
        (packagesDir + "/local/XAdmin/ui")
        (fileset.difference (repoRoot + "/rust") (
          fileset.maybeMissing (repoRoot + "/rust/target")
        ))
      ];
    };

    nativeBuildInputs = [
      yarnBerry
      nodejs20
      cacert
      rustToolchain
      cargoComponent
      wasmTools
      pkg-config
    ];

    buildInputs = [
      openssl
    ];

    dontConfigure = true;
    dontFixup = true;
    dontStrip = true;
    hardeningDisable = [ "all" ];

    LIBCLANG_PATH = "${llvmPackages.libclang.lib}/lib";
    CARGO_TERM_COLOR = "always";
    CARGO_NET_OFFLINE = "true";
    OPENSSL_NO_VENDOR = "1";
    RUSTFLAGS = "--remap-path-prefix ${rustToolchain}=/rustc";
    YARN_ENABLE_TELEMETRY = "0";
    YARN_ENABLE_NETWORK = "0";
    YARN_ENABLE_OFFLINE_MODE = "true";
    COREPACK_ENABLE_NETWORK = "0";
    PSIREBUILD = "true";
    SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";

    buildPhase = ''
      runHook preBuild
      unset NIX_LDFLAGS NIX_LDFLAGS_BEFORE NIX_CFLAGS_LINK LD_LIBRARY_PATH
      unset NIX_CFLAGS_COMPILE NIX_CFLAGS_COMPILE_BEFORE CFLAGS CXXFLAGS LDFLAGS

      export HOME=$NIX_BUILD_TOP/home
      export CARGO_HOME=$NIX_BUILD_TOP/cargo-home
      export TMPDIR=$NIX_BUILD_TOP/tmp
      export CARGO_COMPONENT_CACHE_DIR=$NIX_BUILD_TOP/cargo-component-cache
      mkdir -p "$HOME" "$CARGO_HOME" "$TMPDIR" "$CARGO_COMPONENT_CACHE_DIR" \
        .caches/yarn .cargo

      cp -a ${yarnOfflineCache}/. .caches/yarn/
      chmod -R u+w .caches/yarn

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
      mkdir -p packages/local/XAdmin/ui/wasm/.cargo rust/.cargo
      cp .cargo/config.toml packages/local/XAdmin/ui/wasm/.cargo/config.toml
      cp .cargo/config.toml rust/.cargo/config.toml

      mkdir -p packages/user/CommonApi/common/packages/common-lib/dist
      cp -a ${common-lib}/. packages/user/CommonApi/common/packages/common-lib/dist/
      chmod -R u+w packages/user/CommonApi/common/packages/common-lib/dist

      (
        cd packages
        yarn install --immutable --immutable-cache --mode=skip-build
        export PATH="$PWD/node_modules/.bin:$PATH"
        yarn workspace @psibase/xadmin-ui build
      )
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -a packages/local/XAdmin/ui/dist/. "$out/"
      runHook postInstall
    '';

    doInstallCheck = true;
    installCheckPhase = ''
      runHook preInstallCheck
      test -f "$out/index.html"
      runHook postInstallCheck
    '';
  };
}
